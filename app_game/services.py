"""
Orquestación del spin: monta el motor desde la BD y ejecuta el tiro de forma
ATÓMICA (débito -> cálculo -> Spin -> crédito -> auditoría inmutable).
"""
import json
import random
import uuid
from decimal import ROUND_HALF_UP, Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from app_accounts.models import BalanceEntryKind
from app_accounts.services import apply_balance
from app_audit.models import SpinAuditLog
from app_rtp.models import RTPConfiguration
from app_rtp.services import get_active_rtp_config
from app_wallet_integration.models import (
    PlayerSession,
    TransactionStatus,
    TransactionType,
    WalletTransaction,
)
from app_wallet_integration.wallet import (
    InsufficientWalletFunds,
    WalletError,
    get_wallet_client,
)

from django.db.models import F, Q

from .engine import FreeSpinsSpec, JackpotSpec, SlotEngine, default_paylines, simulate_rtp
from .models import (
    DropJackpot,
    FreeRoundGrant,
    FreeRoundStatus,
    FreeSpinsFeature,
    Game,
    GameBetProfile,
    GameSession,
    OperatorGame,
    Payline,
    ReelStrip,
    Spin,
    SpinStatus,
    Symbol,
    SymbolPayout,
    WinMode,
)


def build_engine(game, math_version, rng=None):
    """Construye un SlotEngine (puro) a partir de la configuración en BD."""
    strips = list(
        ReelStrip.objects.filter(game=game, math_version=math_version).order_by("reel_index")
    )
    if len(strips) != game.grid_cols:
        raise ValidationError(
            f"Configuración inválida: se esperan {game.grid_cols} bandas para "
            f"math_version '{math_version}', se encontraron {len(strips)}."
        )
    reels = [s.strip for s in strips]
    paytable = {
        (p.symbol.code, p.count): p.multiplier
        for p in SymbolPayout.objects.filter(game=game).select_related("symbol")
    }
    paylines = [pl.pattern for pl in game.paylines.order_by("index")]
    wilds = set(game.symbols.filter(is_wild=True).values_list("code", flat=True))

    jackpot = None
    dj = DropJackpot.objects.filter(game=game, is_active=True).first()
    if dj is not None:
        jackpot = JackpotSpec(
            is_active=True, probability=dj.trigger_probability, award_amount=dj.award_amount
        )

    free_spins = None
    fs = FreeSpinsFeature.objects.filter(game=game, is_active=True).first()
    if fs is not None:
        scatters = frozenset(game.symbols.filter(is_scatter=True).values_list("code", flat=True))
        if scatters:  # sin símbolo scatter no hay forma de disparar
            free_spins = FreeSpinsSpec(
                is_active=True, scatter_symbols=scatters,
                trigger_count=fs.trigger_scatter_count, spins_awarded=fs.spins_awarded,
                multiplier=int(fs.multiplier), retrigger=fs.retrigger,
            )

    return SlotEngine(
        reels=reels,
        rows=game.grid_rows,
        cols=game.grid_cols,
        paylines=paylines,
        win_mode=game.win_mode,
        paytable=paytable,
        wild_symbols=wilds,
        jackpot=jackpot,
        free_spins=free_spins,
        rng=rng,
    )


# --------------------------------------------------------------------------- #
# Estado de la ronda de TIRADAS GRATIS (persistido en GameSession.feature_state).
# --------------------------------------------------------------------------- #
def free_spins_precontext(game_session):
    """Antes de tirar: ¿esta tirada es gratis? Devuelve (es_libre, multiplicador)."""
    fsr = (game_session.feature_state or {}).get("free_spins")
    if fsr and fsr.get("remaining", 0) > 0:
        return True, int(fsr.get("multiplier", 1))
    return False, 1


def free_spins_postupdate(game_session, engine, outcome, was_free):
    """
    Tras tirar: actualiza el estado de la ronda. Si la tirada era libre, descuenta una
    y aplica retrigger; si era pagada y disparó, arranca la ronda. Devuelve los tiros
    gratis que quedan (0 si no hay ronda activa).
    """
    fs = engine.free_spins
    state = dict(game_session.feature_state or {})
    if was_free:
        fsr = dict(state.get("free_spins") or {})
        fsr["remaining"] = fsr.get("remaining", 0) - 1
        if fs and fs.retrigger and outcome.free_spins_triggered:
            fsr["remaining"] += fs.spins_awarded
        if fsr["remaining"] <= 0:
            state.pop("free_spins", None)
        else:
            state["free_spins"] = fsr
    elif outcome.free_spins_triggered and fs:
        state["free_spins"] = {"remaining": fs.spins_awarded, "multiplier": fs.multiplier}
    game_session.feature_state = state
    game_session.save(update_fields=["feature_state"])
    return (state.get("free_spins") or {}).get("remaining", 0)


# --------------------------------------------------------------------------- #
# TIRADAS GRATIS OTORGADAS (FreeRoundGrant): concesión y consumo.
# --------------------------------------------------------------------------- #
def _active_free_round_grant(game_session):
    """
    Concesión de tiradas gratis CONSUMIBLE para esta sesión (o None), BLOQUEADA para
    evitar doble consumo entre giros concurrentes. Prioriza la que caduca antes.
    """
    game = game_session.game
    currency = game_session.currency
    qs = FreeRoundGrant.objects.select_for_update(skip_locked=True).filter(
        game=game, currency=currency, status=FreeRoundStatus.ACTIVE, remaining__gt=0,
    )
    if game_session.player_session_id:
        ps = game_session.player_session
        qs = qs.filter(operator_id=ps.operator_id, external_player_id=ps.external_player_id)
    elif game_session.player_user_id:
        qs = qs.filter(player_user_id=game_session.player_user_id)
    else:
        return None
    now = timezone.now()
    qs = qs.filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    return qs.order_by(F("expires_at").asc(nulls_last=True), "created_at").first()


def _consume_free_round(grant):
    """Descuenta una tirada gratis de la concesión y la marca consumida si se agota."""
    grant.remaining = max(0, grant.remaining - 1)
    if grant.remaining <= 0:
        grant.status = FreeRoundStatus.DEPLETED
    grant.save(update_fields=["remaining", "status", "updated_at"])


def grant_free_rounds(
    *, game, currency, quantity, operator=None, external_player_id="", player_user=None,
    bet_amount=None, win_multiplier=1, expires_at=None, note="",
):
    """
    Concede `quantity` tiradas gratis a un jugador en un slot. `bet_amount` (unidades
    menores) por defecto = apuesta por defecto del juego para esa moneda. Devuelve el
    FreeRoundGrant creado. Valida que exista perfil de apuesta para la moneda.
    """
    currency = (currency or "").upper()
    profile = game.bet_profiles.filter(currency=currency, is_active=True).first()
    if profile is None:
        raise ValidationError(f"El juego no tiene apuestas configuradas en {currency}.")
    if quantity < 1:
        raise ValidationError("La cantidad de tiradas gratis debe ser >= 1.")
    bet = bet_amount if bet_amount is not None else profile.default_bet
    if not (profile.min_bet <= bet <= profile.max_bet):
        raise ValidationError(
            f"La apuesta de la ronda gratis ({bet}) está fuera de rango "
            f"[{profile.min_bet}, {profile.max_bet}] para {currency}."
        )
    return FreeRoundGrant.objects.create(
        game=game, currency=currency, operator=operator,
        external_player_id=external_player_id or "", player_user=player_user,
        bet_amount=bet, total=quantity, remaining=quantity,
        win_multiplier=max(1, int(win_multiplier)), expires_at=expires_at, note=note or "",
    )


def _validate_bet(game, currency, bet_amount):
    profile = game.bet_profiles.filter(currency=currency, is_active=True).first()
    if profile is None:
        return  # demo sin perfil: no se valida el rango
    if not (profile.min_bet <= bet_amount <= profile.max_bet):
        raise ValidationError(
            f"Apuesta {bet_amount} fuera de rango "
            f"[{profile.min_bet}, {profile.max_bet}] para {currency}."
        )


def _settle_wallet(*, wallet, operator, player_session, tx_type, amount, idempotency_key, spin=None):
    """Crea (idempotente) una WalletTransaction y llama a la billetera."""
    tx, created = WalletTransaction.objects.get_or_create(
        operator=operator,
        idempotency_key=idempotency_key,
        defaults=dict(
            player_session=player_session,
            spin=spin,
            type=tx_type,
            amount=amount,
            currency=player_session.currency,
            status=TransactionStatus.PENDING,
        ),
    )
    if not created and tx.status == TransactionStatus.CONFIRMED:
        return tx  # reintento: ya confirmada, no se duplica

    method = wallet.debit if tx_type == TransactionType.DEBIT else wallet.credit
    try:
        resp = method(
            external_player_id=player_session.external_player_id,
            amount=amount,
            currency=player_session.currency,
            idempotency_key=idempotency_key,
            reference=str(spin.id) if spin else "",
        )
    except WalletError:
        # Fallo de la billetera del operador (saldo insuficiente, red, 5xx): se marca
        # la transacción como fallida y se propaga para que el flujo lo maneje.
        tx.status = TransactionStatus.FAILED
        tx.save(update_fields=["status", "updated_at"])
        raise
    tx.status = TransactionStatus.CONFIRMED
    tx.external_reference = resp.get("external_reference", "")
    tx.response_payload = resp
    if spin is not None and tx.spin_id is None:
        tx.spin = spin
    tx.save(update_fields=["status", "external_reference", "response_payload", "spin", "updated_at"])
    return tx


@transaction.atomic
def execute_spin(*, game_session, bet_amount, idempotency_key, rng=None):
    """
    Ejecuta un tiro completo dentro de una transacción de BD.
    Devuelve (Spin, SpinOutcome). `rng` es inyectable para tests deterministas.
    """
    game = game_session.game
    player_session = game_session.player_session
    operator = player_session.operator
    currency = game_session.currency

    _validate_bet(game, currency, bet_amount)

    rtp_config = get_active_rtp_config(game=game, operator=operator)
    engine = build_engine(game, rtp_config.math_version, rng=rng)

    wallet = get_wallet_client(operator)

    # ¿Tirada dentro de una ronda de tiradas gratis por SCATTER? No se cobra y multiplica.
    in_scatter_round, win_mult = free_spins_precontext(game_session)

    # Si no hay ronda de scatter activa, ¿tiene el jugador tiradas gratis OTORGADAS en
    # este slot? Se consume una: no se cobra, se juega a la apuesta fija de la concesión.
    grant = None
    if not in_scatter_round:
        grant = _active_free_round_grant(game_session)
        if grant is not None:
            bet_amount = grant.bet_amount
            win_mult = grant.win_multiplier
    is_free = in_scatter_round or grant is not None

    # `wallet_balance`: saldo REAL que devuelve el operador (seamless). None en demo.
    wallet_balance = None

    # 1) DÉBITO de la apuesta (idempotente). En tiradas gratis NO se cobra.
    # InsufficientWalletFunds se propaga: no se tira si no hay saldo real.
    if not is_free:
        debit_tx = _settle_wallet(
            wallet=wallet, operator=operator, player_session=player_session,
            tx_type=TransactionType.DEBIT, amount=bet_amount,
            idempotency_key=f"{idempotency_key}:debit",
        )
        wallet_balance = (debit_tx.response_payload or {}).get("balance", wallet_balance)

    # A partir de aquí YA hubo débito externo: si algo falla, hay que revertirlo.
    try:
        # 2) CÁLCULO del resultado (servidor autoritativo)
        outcome = engine.spin(bet_amount, win_multiplier=win_mult)
        # Solo la ronda de SCATTER actualiza feature_state; una ronda otorgada que
        # además saque scatters SÍ puede arrancar una ronda de scatter (was_free=False).
        free_spins_remaining = free_spins_postupdate(game_session, engine, outcome, in_scatter_round)
        if grant is not None:
            _consume_free_round(grant)

        # 3) Persistir el SPIN
        spin = Spin.objects.create(
            game=game, game_session=game_session, rtp_config=rtp_config,
            math_version=rtp_config.math_version, bet_amount=bet_amount,
            win_amount=outcome.total_win, currency=currency,
            lines_played=len(engine.paylines), matrix_result=outcome.matrix,
            winning_lines=outcome.winning_lines_json(),
            rng_algorithm="secrets.SystemRandom", rng_seed=json.dumps(outcome.stops),
            status=SpinStatus.SETTLED,
        )
        WalletTransaction.objects.filter(
            operator=operator, idempotency_key=f"{idempotency_key}:debit", spin__isnull=True
        ).update(spin=spin)

        # 4) CRÉDITO del premio (idempotente) solo si hay premio
        if outcome.total_win > 0:
            credit_tx = _settle_wallet(
                wallet=wallet, operator=operator, player_session=player_session,
                tx_type=TransactionType.CREDIT, amount=outcome.total_win,
                idempotency_key=f"{idempotency_key}:credit", spin=spin,
            )
            wallet_balance = (credit_tx.response_payload or {}).get("balance", wallet_balance)
    except Exception:
        # Revierte el débito externo ya realizado (el ROLLBACK de la BD no lo deshace).
        if not is_free:
            try:
                wallet.rollback(
                    external_player_id=player_session.external_player_id, amount=bet_amount,
                    currency=currency, idempotency_key=f"{idempotency_key}:rollback",
                    reference=idempotency_key,
                )
            except WalletError:
                pass  # conciliación posterior si el rollback también falla
        raise

    # 5) AUDITORÍA inmutable (encadenada por hash en el propio modelo)
    SpinAuditLog.objects.create(
        spin_id=spin.id, operator_id=operator.id,
        external_player_id=player_session.external_player_id, game_id=game.id,
        bet_amount=bet_amount, win_amount=outcome.total_win, currency=currency,
        matrix_result=outcome.matrix, winning_lines=outcome.winning_lines_json(),
        rtp_applied=rtp_config.target_rtp, rtp_config_id=rtp_config.id,
        math_version=rtp_config.math_version, rng_algorithm="secrets.SystemRandom",
        rng_seed=json.dumps(outcome.stops),
    )

    meta = {
        "in_free_spins": is_free,
        "free_spins_remaining": free_spins_remaining,
        "free_rounds_remaining": grant.remaining if grant is not None else 0,
        "bet_amount": bet_amount,  # puede diferir del pedido si fue ronda otorgada
        "wallet_balance": wallet_balance,  # saldo real del operador (None en demo)
    }
    return spin, outcome, meta


# --------------------------------------------------------------------------- #
# Modo PROVEEDOR: operador externo (autenticado por API key) contra su billetera.
# --------------------------------------------------------------------------- #
def launch_operator_session(*, operator, game, external_player_id, currency, balance=None):
    """
    Abre una sesión para un jugador de un OPERADOR externo.

    AISLAMIENTO: el juego debe estar ASIGNADO y habilitado para ese operador
    (OperatorGame). Un operador no puede lanzar juegos que no le corresponden.

    MULTIMONEDA: la moneda la fija el operador POR SESIÓN (la envía en el launch). No
    hay moneda por defecto de operador. El juego debe tener un GameBetProfile activo
    para esa moneda (denominaciones locales); si no, se rechaza.

    SALDO: si el operador envía `balance` (unidades menores), el saldo mostrado se
    SINCRONIZA con él en cada launch (refleja el saldo real del jugador en el operador;
    puente hacia el seamless wallet). Si no lo envía, se usa el saldo demo por defecto.

    Reutiliza (o crea) la PlayerSession del jugador EN ESA MONEDA y abre una GameSession
    nueva para el juego pedido.
    """
    assigned = OperatorGame.objects.filter(
        operator=operator, game=game, is_enabled=True
    ).exists()
    if not assigned:
        raise ValidationError(
            "El juego no está asignado a este operador.", code="not_assigned"
        )

    currency = (currency or "").upper()
    if not game.bet_profiles.filter(currency=currency, is_active=True).exists():
        raise ValidationError(
            f"El juego no está configurado para la moneda {currency}.", code="bad_currency"
        )

    player_session = (
        PlayerSession.objects.filter(
            operator=operator, external_player_id=external_player_id,
            currency=currency, is_active=True,
        )
        .order_by("created_at")
        .first()
    )
    if player_session is None:
        player_session = PlayerSession.objects.create(
            operator=operator, external_player_id=external_player_id, currency=currency,
            demo_balance=balance if balance is not None else _demo_start_balance(currency),
        )
    elif balance is not None:
        # El operador manda el saldo real: se sincroniza en cada apertura.
        player_session.demo_balance = balance
        player_session.save(update_fields=["demo_balance"])

    # Reutiliza la GameSession ABIERTA de este jugador+juego si existe, para que el
    # estado con memoria (feature_state: tiradas gratis en curso) PERSISTA al cerrar y
    # volver a abrir el juego. Solo abre una nueva si no hay ninguna abierta. (Igual que
    # el flujo interno; filter().first() tolera duplicados de StrictMode.)
    session = (
        GameSession.objects.filter(
            game=game, player_session=player_session, is_open=True
        )
        .order_by("created_at")
        .first()
    )
    if session is None:
        session = GameSession.objects.create(
            game=game, player_session=player_session, is_open=True, currency=currency
        )
    return session


def _demo_start_balance(currency: str) -> int:
    """Saldo inicial demo en unidades menores (solo fun-money): N unidades mayores
    ajustadas al exponente de la moneda (10.000 por defecto)."""
    from common.models import Currency
    from django.conf import settings

    units = getattr(settings, "DEMO_START_BALANCE_UNITS", 10_000)
    cur = Currency.objects.filter(code=currency).first()
    exp = cur.exponent if cur else 2
    return units * (10 ** exp)


# --------------------------------------------------------------------------- #
# Modo plataforma propia: jugador INTERNO contra su monedero interno.
# --------------------------------------------------------------------------- #
def launch_internal_session(*, user, game):
    """
    Abre (o reutiliza) una sesión de juego abierta para un jugador interno.

    Usa filter().first() en vez de get_or_create para TOLERAR duplicados: el doble
    montaje de React StrictMode (dev) puede lanzar dos veces y crear dos sesiones.
    Reutiliza la más antigua abierta; nunca lanza MultipleObjectsReturned.
    """
    session = (
        GameSession.objects.filter(game=game, player_user=user, is_open=True)
        .order_by("created_at")
        .first()
    )
    if session is None:
        session = GameSession.objects.create(
            game=game, player_user=user, is_open=True, currency=user.wallet.currency
        )
    return session


@transaction.atomic
def execute_internal_spin(*, game_session, bet_amount, rng=None):
    """
    Tiro de un JUGADOR INTERNO: debita la apuesta de su monedero, calcula el
    resultado, acredita el premio y registra Spin + auditoría. Todo atómico: si
    algo falla, se revierte TODO (incluido el movimiento de saldo).
    """
    game = game_session.game
    user = game_session.player_user
    currency = game_session.currency

    _validate_bet(game, currency, bet_amount)

    rtp_config = get_active_rtp_config(game=game, operator=None)
    engine = build_engine(game, rtp_config.math_version, rng=rng)

    wallet_id = user.wallet.pk
    ref = str(uuid.uuid4())

    # ¿Ronda de tiradas gratis por SCATTER? No se cobra y se multiplica.
    in_scatter_round, win_mult = free_spins_precontext(game_session)

    # Tiradas gratis OTORGADAS a este jugador interno en este slot.
    grant = None
    if not in_scatter_round:
        grant = _active_free_round_grant(game_session)
        if grant is not None:
            bet_amount = grant.bet_amount
            win_mult = grant.win_multiplier
    is_free = in_scatter_round or grant is not None

    # 1) DÉBITO de la apuesta (0 en tiradas gratis).
    if not is_free:
        apply_balance(wallet_id=wallet_id, delta=-bet_amount, kind=BalanceEntryKind.BET, reference=ref)

    # 2) Resultado (servidor autoritativo).
    outcome = engine.spin(bet_amount, win_multiplier=win_mult)
    free_spins_remaining = free_spins_postupdate(game_session, engine, outcome, in_scatter_round)
    if grant is not None:
        _consume_free_round(grant)

    # 3) Persistir el Spin.
    spin = Spin.objects.create(
        game=game, game_session=game_session, rtp_config=rtp_config,
        math_version=rtp_config.math_version, bet_amount=bet_amount,
        win_amount=outcome.total_win, currency=currency, lines_played=len(engine.paylines),
        matrix_result=outcome.matrix, winning_lines=outcome.winning_lines_json(),
        rng_algorithm="secrets.SystemRandom", rng_seed=json.dumps(outcome.stops),
        status=SpinStatus.SETTLED,
    )

    # 4) CRÉDITO del premio (si lo hay).
    if outcome.total_win > 0:
        apply_balance(
            wallet_id=wallet_id, delta=outcome.total_win,
            kind=BalanceEntryKind.WIN, reference=str(spin.id),
        )

    # 5) Auditoría inmutable (jugador interno: sin operador).
    SpinAuditLog.objects.create(
        spin_id=spin.id, operator_id=None, player_user_id=user.id,
        external_player_id=(user.email or str(user.id)), game_id=game.id,
        bet_amount=bet_amount, win_amount=outcome.total_win, currency=currency,
        matrix_result=outcome.matrix, winning_lines=outcome.winning_lines_json(),
        rtp_applied=rtp_config.target_rtp, rtp_config_id=rtp_config.id,
        math_version=rtp_config.math_version, rng_algorithm="secrets.SystemRandom",
        rng_seed=json.dumps(outcome.stops),
    )
    meta = {
        "in_free_spins": is_free,
        "free_spins_remaining": free_spins_remaining,
        "free_rounds_remaining": grant.remaining if grant is not None else 0,
        "bet_amount": bet_amount,
    }
    return spin, outcome, meta


# --------------------------------------------------------------------------- #
# Creación de casinos (reskin): clonar una plantilla + tema por juego.
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_game_from_template(*, template_slug, name, slug, title="", background_color="#0b0f1a"):
    """
    Crea un juego nuevo CLONANDO la matemática de una plantilla (símbolos, líneas,
    paytable, bandas, RTP, apuestas). Misma matemática certificable; solo cambian
    nombre, tema y (luego) los assets. No copia los assets ni el jackpot.
    """
    template = Game.objects.get(slug=template_slug)

    game = Game.objects.create(
        name=name, slug=slug, description=template.description,
        grid_cols=template.grid_cols, grid_rows=template.grid_rows,
        win_mode=template.win_mode, volatility=template.volatility,
        max_win_multiplier=template.max_win_multiplier, is_active=True,
        is_template=False, title=title, background_color=background_color,
    )

    code_map = {}
    for s in template.symbols.all():
        code_map[s.code] = Symbol.objects.create(
            game=game, code=s.code, name=s.name, asset_key=s.asset_key,
            is_wild=s.is_wild, is_scatter=s.is_scatter,
        )
    for pl in template.paylines.all():
        Payline.objects.create(game=game, index=pl.index, pattern=pl.pattern)
    for po in template.payouts.select_related("symbol"):
        SymbolPayout.objects.create(
            game=game, symbol=code_map[po.symbol.code], count=po.count, multiplier=po.multiplier
        )
    for rs in template.reel_strips.all():
        ReelStrip.objects.create(
            game=game, math_version=rs.math_version, reel_index=rs.reel_index, strip=rs.strip
        )
    for bp in template.bet_profiles.all():
        GameBetProfile.objects.create(
            game=game, currency=bp.currency, min_bet=bp.min_bet, max_bet=bp.max_bet,
            default_bet=bp.default_bet, bet_levels=bp.bet_levels, is_active=bp.is_active,
        )
    for rc in template.rtp_configurations.filter(operator__isnull=True):
        RTPConfiguration.objects.create(
            game=game, operator=None, name=rc.name, target_rtp=rc.target_rtp,
            house_margin=rc.house_margin, math_version=rc.math_version,
            certification_reference=rc.certification_reference, is_active=rc.is_active,
            effective_from=timezone.now(), effective_to=None,
        )
    return game


@transaction.atomic
def create_configurable_game(*, spec, math_version="v1"):
    """
    Crea un casino TOTALMENTE CONFIGURABLE desde una especificación (el builder del
    master): grid, símbolos con peso, combinaciones (paytable), líneas, RTP y
    perfiles de apuesta por moneda. Genera las bandas a partir de los pesos.

    El RTP resultante DEBE verificarse con el simulador (`simulate_game_rtp`): el
    motor no lo ajusta, emerge de bandas + paytable. Cada casino así definido es
    una matemática propia (a certificar por separado en producción).
    """
    game = Game.objects.create(
        name=spec["name"], slug=spec["slug"], title=spec.get("title", ""),
        grid_cols=spec["grid_cols"], grid_rows=spec["grid_rows"],
        win_mode=spec["win_mode"], volatility=spec.get("volatility", "MEDIUM"),
        max_win_multiplier=spec.get("max_win_multiplier", 1000), is_active=True, is_template=False,
        background_color=spec.get("background_color", "#0b0f1a"),
        accent_color=spec.get("accent_color", "#ffd23f"),
        background_type=spec.get("background_type", "COLOR"),
        background_gradient=spec.get("background_gradient", ""),
    )

    sym_objs = {}
    for s in spec["symbols"]:
        sym_objs[s["code"]] = Symbol.objects.create(
            game=game, code=s["code"], name=s.get("name", s["code"]),
            is_wild=s.get("is_wild", False), is_scatter=s.get("is_scatter", False),
            weight=s.get("weight", 1), asset_key=s["code"].lower(),
        )

    for p in spec["payouts"]:
        SymbolPayout.objects.create(
            game=game, symbol=sym_objs[p["code"]], count=p["count"], multiplier=Decimal(str(p["multiplier"]))
        )

    if game.win_mode == WinMode.LINES:
        patterns = spec.get("paylines") or default_paylines(game.grid_cols, game.grid_rows)
        for i, pat in enumerate(patterns):
            Payline.objects.create(game=game, index=i, pattern=list(pat))

    # Banda base generada desde los pesos (cada símbolo aparece `weight` veces).
    base_strip = []
    for s in spec["symbols"]:
        base_strip.extend([s["code"]] * max(1, s.get("weight", 1)))
    # Una banda BARAJADA y DISTINTA por rodillo: mismos pesos (mismo RTP), pero
    # las ventanas visibles ya no muestran símbolos contiguos ni rodillos
    # correlacionados => tableros de aspecto natural. Sembrado por slug para que
    # sea REPRODUCIBLE (mismo casino => mismas bandas; requisito de certificación).
    rng = random.Random(f"{game.slug}:{math_version}")
    for reel in range(game.grid_cols):
        strip = base_strip[:]
        rng.shuffle(strip)
        ReelStrip.objects.create(game=game, math_version=math_version, reel_index=reel, strip=strip)

    target = Decimal(str(spec["target_rtp"]))
    RTPConfiguration.objects.create(
        game=game, operator=None, name="default", target_rtp=target,
        house_margin=Decimal("1") - target, math_version=math_version,
        is_active=True, effective_from=timezone.now(),
    )

    for bp in spec["bet_profiles"]:
        GameBetProfile.objects.create(
            game=game, currency=bp["currency"], min_bet=bp["min_bet"], max_bet=bp["max_bet"],
            default_bet=bp["default_bet"], bet_levels=bp.get("bet_levels", []), is_active=True,
        )

    # Tiradas gratis (opcional): solo tiene sentido con al menos un símbolo scatter.
    fs = spec.get("free_spins")
    if fs and fs.get("is_active"):
        has_scatter = any(s.get("is_scatter") for s in spec["symbols"])
        if has_scatter:
            FreeSpinsFeature.objects.create(
                game=game, is_active=True,
                trigger_scatter_count=fs.get("trigger_scatter_count", 3),
                spins_awarded=fs.get("spins_awarded", 10),
                multiplier=Decimal(str(fs.get("multiplier", 1))),
                retrigger=fs.get("retrigger", True),
            )

    # Sanidad: el motor debe construir y tirar sin error con esta configuración.
    engine = build_engine(game, math_version)
    engine.spin(spec["bet_profiles"][0]["default_bet"])

    # CUADRE DE RTP: se escala la paytable hasta que el RTP medido ~ objetivo, para
    # que el casino entregue de verdad el % pedido (y no el que "salga" de los pesos).
    calibrate_game_rtp(game, math_version=math_version, target_rtp=target)
    return game


def _scale_payouts(payouts, factor):
    """Escala todos los multiplicadores por `factor` (Decimal), a 2 decimales."""
    for p in payouts:
        scaled = (p.multiplier * factor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        p.multiplier = max(Decimal("0.01"), scaled)
    SymbolPayout.objects.bulk_update(payouts, ["multiplier"])


def _simulated_rtp(game, math_version, bet, spins, seeds=3) -> float:
    """RTP MEDIDO por simulación (incluye truncado y feature), promedio de varias
    semillas para reducir el ruido en juegos volátiles."""
    vals = [
        simulate_rtp(build_engine(game, math_version, rng=random.Random(f"{game.slug}:cal:{s}")), bet, spins)["rtp"]
        for s in range(seeds)
    ]
    return sum(vals) / len(vals)


def calibrate_game_rtp(game, *, math_version, target_rtp, tol=0.0025):
    """
    Ajusta la PAYTABLE para que el RTP MEDIDO coincida con el objetivo.

    Dos fases:
      1) ANALÍTICA (solo LINES): valor cerrado y sin ruido → cuadra rápido la "forma".
      2) SIMULACIÓN: mide el RTP real (incluye el truncado a céntimos y el feature, que
         el analítico ignora) y hace la corrección final. En WAYS solo se usa esta fase.

    Escalar la paytable calibra también las tiradas gratis (mismos multiplicadores ×
    su multiplicador de ronda), así que un único factor cuadra el RTP TOTAL. El RNG y
    las bandas NO se tocan: los tiros siguen siendo independientes (certificable).
    Devuelve el RTP simulado final.
    """
    target = float(target_rtp)
    payouts = list(SymbolPayout.objects.filter(game=game))
    if target <= 0 or not payouts:
        return 0.0

    profile = game.bet_profiles.filter(is_active=True).first()
    bet = profile.default_bet if profile else 100

    # Fase 1: cuadre analítico exacto (LINES). Deja la paytable muy cerca sin varianza.
    for _ in range(6):
        analytic = build_engine(game, math_version).analytic_line_rtp()
        if analytic is None:  # WAYS: no aplica la fórmula cerrada
            break
        if analytic <= 0 or abs(analytic - target) <= 0.0008:
            break
        _scale_payouts(payouts, Decimal(str(target / analytic)))

    # Fase 2: corrección por simulación (truncado + feature). Pocas iteraciones bastan.
    measured = _simulated_rtp(game, math_version, bet, 60_000)
    for _ in range(4):
        if measured <= 0 or abs(measured - target) <= tol:
            break
        _scale_payouts(payouts, Decimal(str(target / measured)))
        measured = _simulated_rtp(game, math_version, bet, 60_000)
    return measured


def resize_game(game, *, grid_cols, grid_rows):
    """
    Cambia el tamaño de la rejilla (rodillos × filas) de un casino YA creado.

    Es una edición de MATEMÁTICA, no solo visual, así que:
      1. Regenera las BANDAS desde los pesos de los símbolos (una por rodillo nuevo).
      2. Arregla los PAGOS cuyo `count` supere los rodillos nuevos (los recorta a
         `grid_cols`; si quedan duplicados por símbolo, conserva el de mayor multiplicador).
      3. En modo LÍNEAS, regenera las líneas por defecto (las dibujadas a mano dejan de
         ser válidas al cambiar el tamaño).
      4. RE-CALIBRA el RTP al objetivo vigente (la matemática cambió).

    Devuelve el juego.
    """
    grid_cols = int(grid_cols)
    grid_rows = int(grid_rows)
    if not (3 <= grid_cols <= 7 and 3 <= grid_rows <= 6):
        raise ValidationError("Rodillos permitidos 3–7 y filas 3–6.")

    rtp_config = get_active_rtp_config(game=game, operator=None)
    math_version = rtp_config.math_version

    game.grid_cols = grid_cols
    game.grid_rows = grid_rows
    game.save(update_fields=["grid_cols", "grid_rows"])

    # 1) Bandas nuevas desde los pesos (mismo criterio que al crear el casino).
    base_strip = []
    for s in game.symbols.all():
        base_strip.extend([s.code] * max(1, s.weight))
    rng = random.Random(f"{game.slug}:{math_version}:resize:{grid_cols}x{grid_rows}")
    ReelStrip.objects.filter(game=game, math_version=math_version).delete()
    for reel in range(grid_cols):
        strip = base_strip[:]
        rng.shuffle(strip)
        ReelStrip.objects.create(game=game, math_version=math_version, reel_index=reel, strip=strip)

    # 2) Pagos con count > rodillos nuevos: se recortan; se deduplica por (símbolo, count)
    #    conservando el de MAYOR multiplicador para que ningún símbolo se quede sin pago.
    payouts = list(SymbolPayout.objects.filter(game=game))
    for p in payouts:
        p.count = min(p.count, grid_cols)
    payouts.sort(key=lambda x: (x.symbol_id, x.count, -float(x.multiplier)))
    seen = set()
    for p in payouts:
        key = (p.symbol_id, p.count)
        if key in seen:
            p.delete()
        else:
            seen.add(key)
            p.save(update_fields=["count"])

    # 3) Líneas por defecto (solo LÍNEAS). En WAYS no hay líneas.
    if game.win_mode == WinMode.LINES:
        Payline.objects.filter(game=game).delete()
        for i, pat in enumerate(default_paylines(grid_cols, grid_rows)):
            Payline.objects.create(game=game, index=i, pattern=list(pat))

    # 4) Re-cuadre del RTP (la matemática cambió).
    calibrate_game_rtp(game, math_version=math_version, target_rtp=rtp_config.target_rtp)
    return game


def set_game_target_rtp(game, target_rtp):
    """
    Cambia el RTP objetivo de un casino YA creado y RE-CALIBRA la paytable para
    cumplirlo. Devuelve el RTP final medido tras el cuadre.
    """
    rtp_config = get_active_rtp_config(game=game, operator=None)
    target = Decimal(str(target_rtp))
    rtp_config.target_rtp = target
    rtp_config.house_margin = Decimal("1") - target
    rtp_config.save(update_fields=["target_rtp", "house_margin"])
    return calibrate_game_rtp(game, math_version=rtp_config.math_version, target_rtp=target)


def simulate_game_rtp(game, spins, bet_amount=None):
    """Corre Monte Carlo sobre la config vigente y devuelve RTP medido vs objetivo."""
    rtp_config = get_active_rtp_config(game=game, operator=None)
    # QA/verificación: se usa Mersenne Twister (random.Random), mucho más rápido
    # que el CSPRNG de producción. Para MEDIR el RTP es equivalente (uniforme) y
    # evita bloquear el worker varios segundos en 100k+ tiros.
    engine = build_engine(game, rtp_config.math_version, rng=random.Random())
    if bet_amount is None:
        profile = game.bet_profiles.filter(is_active=True).first()
        bet_amount = profile.default_bet if profile else 100
    res = simulate_rtp(engine, bet_amount, spins)
    res["target_rtp"] = float(rtp_config.target_rtp)
    res["bet_amount"] = bet_amount
    res["deviation"] = res["rtp"] - res["target_rtp"]
    return res


def build_theme(game):
    """Tema que el cliente usa para renderizar. `image_url` nulo => placeholder."""
    symbols = [
        {
            "code": s.code,
            "label": s.name or s.code,
            "is_wild": s.is_wild,
            "is_scatter": s.is_scatter,
            "image_url": s.image.url if s.image else None,
        }
        for s in game.symbols.all()
    ]
    def _url(f):
        return f.url if f else None

    # Líneas de pago (solo LINES): el cliente las necesita para resaltar la
    # combinación ganadora en cualquier grid/patrón, no solo en el 3x3 clásico.
    paylines = (
        [pl.pattern for pl in game.paylines.order_by("index")]
        if game.win_mode == WinMode.LINES
        else []
    )

    return {
        "title": game.title or game.name,
        "background_color": game.background_color,
        "accent_color": game.accent_color,
        "background_type": game.background_type,
        "background_gradient": game.background_gradient,
        "win_mode": game.win_mode,
        "paylines": paylines,
        "symbols": symbols,
        "assets": {
            "background": _url(game.background_image),
            "background_video": _url(game.background_video),
            "logo": _url(game.logo),
            "prize_banner": _url(game.prize_banner),
            "spin_button": _url(game.spin_button),
            "music_on": _url(game.music_on),
            "music_off": _url(game.music_off),
            "music_track": _url(game.music_track),
            "turbo_on": _url(game.turbo_on),
            "turbo_off": _url(game.turbo_off),
            "auto_on": _url(game.auto_on),
            "auto_off": _url(game.auto_off),
            "bet_plus": _url(game.bet_plus),
            "bet_minus": _url(game.bet_minus),
        },
    }


def build_paytable(game):
    """
    Tabla de pagos del juego para mostrar al jugador (botón '?'). Por juego, así
    cada casino puede tener sus propias combinaciones en el futuro.
    """
    payouts: dict = {}
    for p in game.payouts.select_related("symbol").order_by("count"):
        payouts.setdefault(p.symbol.code, []).append(
            {"count": p.count, "multiplier": str(p.multiplier)}
        )

    rows = []
    for s in game.symbols.all():
        ps = payouts.get(s.code, [])
        max_mult = max((float(x["multiplier"]) for x in ps), default=0.0)
        rows.append(
            {
                "code": s.code,
                "label": s.name or s.code,
                "is_wild": s.is_wild,
                "image_url": s.image.url if s.image else None,
                "payouts": ps,
                "_max": max_mult,
            }
        )
    rows.sort(key=lambda r: r["_max"], reverse=True)  # símbolos de más a menos valor
    for r in rows:
        r.pop("_max")

    ways = game.grid_rows ** game.grid_cols
    return {
        "win_mode": game.win_mode,
        "lines": game.paylines.count() if game.win_mode == "LINES" else ways,
        "symbols": rows,
    }
