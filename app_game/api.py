import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.db.models import Count, Sum

from django.contrib.auth import get_user_model

from app_accounts.models import Profile, Role
from app_accounts.permissions import IsMaster, IsOperatorUser
from app_accounts.services import InsufficientFunds
from app_rtp.services import RTPConfigError
from app_wallet_integration.fx import convert_currency_totals
from app_wallet_integration.models import Operator, PlayerSession, WalletMode
from app_wallet_integration.permissions import HasOperatorApiKey, HasSessionToken
from app_wallet_integration.services import generate_api_key
from app_wallet_integration.tokens import make_session_token
from app_wallet_integration.wallet import resolve_wallet_secret
from app_wallet_integration.wallet import InsufficientWalletFunds, WalletError
from common.models import Currency
from common.pagination import paginate

from .geo import resolve_currency
from .models import BackgroundType, FreeRoundGrant, Game, GameSession, OperatorGame, Spin, Symbol
from .serializers import (
    ApiKeyCreateSerializer,
    EmbedSpinSerializer,
    FreeRoundGrantSerializer,
    GameBuildSerializer,
    GameCreateSerializer,
    GameThemeSerializer,
    LaunchSerializer,
    OperatorCreateSerializer,
    OperatorGameAssignSerializer,
    OperatorPasswordSerializer,
    OperatorUserCreateSerializer,
    PlaySpinSerializer,
    WalletConfigSerializer,
    WebhookSecretRefSerializer,
    ProviderFreeRoundSerializer,
    ProviderLaunchSerializer,
    SimulateSerializer,
    SpinRequestSerializer,
)
from .services import (
    build_paytable,
    build_theme,
    create_configurable_game,
    create_game_from_template,
    execute_internal_spin,
    execute_spin,
    free_spins_precontext,
    launch_internal_session,
    grant_free_rounds,
    launch_operator_session,
    resize_game,
    set_game_target_rtp,
    simulate_game_rtp,
)

User = get_user_model()

# Campos de assets del juego que el master puede subir (whitelist).
GAME_IMAGE_FIELDS = {
    "thumbnail", "background_image", "logo", "prize_banner", "spin_button",
    "music_on", "music_off", "turbo_on", "turbo_off", "auto_on", "auto_off",
    "bet_plus", "bet_minus",
}
GAME_FILE_FIELDS = {"music_track", "background_video"}


class SpinView(APIView):
    """
    POST /api/v1/spin/  (operador externo, autenticado por API key)

    Ejecuta un tiro de forma ATÓMICA: débito + cálculo + Spin + crédito + auditoría,
    todo en una transacción de BD.

    Cabecera: Authorization: Api-Key <clave del operador>
    Body: {"game_session": "<uuid>", "bet_amount": <int céntimos>, "idempotency_key": "<str>"}

    SEGURIDAD: el operador se resuelve de la API key (request.operator), y se VERIFICA
    que la game_session pertenezca a ese operador. Así un operador no puede tirar sobre
    sesiones de otro aunque conozca (o adivine) su UUID. La idempotency_key la genera el
    cliente por intento de spin para evitar débitos duplicados.
    """

    permission_classes = [HasOperatorApiKey]

    def post(self, request):
        req = SpinRequestSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        data = req.validated_data

        game_session = get_object_or_404(GameSession, id=data["game_session"], is_open=True)

        # AISLAMIENTO: la sesión debe ser de una PlayerSession de ESTE operador.
        ps = game_session.player_session
        if ps is None or ps.operator_id != request.operator.id:
            return Response(
                {"detail": "La sesión no pertenece a este operador."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            spin, outcome, meta = execute_spin(
                game_session=game_session,
                bet_amount=data["bet_amount"],
                idempotency_key=data["idempotency_key"],
            )
        except (ValidationError, RTPConfigError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {"spin_id": spin.id, **_spin_payload(outcome, game_session.currency, meta)},
            status=status.HTTP_200_OK,
        )


class ProviderLaunchView(APIView):
    """
    POST /api/v1/provider/launch/  (operador externo, autenticado por API key)

    El backend del operador abre una sesión de juego para uno de SUS jugadores. Solo
    puede lanzar juegos que tenga ASIGNADOS (OperatorGame). Devuelve el estado inicial
    (game_session, rejilla, apuestas, tema, paytable) para arrancar el iframe.

    Cabecera: Authorization: Api-Key <clave del operador>
    Body: {"game": "<slug>", "external_player_id": "<id en el casino>", "currency": "USD"}
    """

    permission_classes = [HasOperatorApiKey]

    def post(self, request):
        req = ProviderLaunchSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        d = req.validated_data
        game = get_object_or_404(Game, slug=d["game"], is_active=True)
        try:
            session = launch_operator_session(
                operator=request.operator, game=game,
                external_player_id=d["external_player_id"], currency=d["currency"],
                balance=d.get("balance"),
            )
        except ValidationError as exc:
            # "no asignado" => 403 (autorización); moneda no soportada => 400.
            code = exc.error_list[0].code if exc.error_list else None
            http = status.HTTP_403_FORBIDDEN if code == "not_assigned" else status.HTTP_400_BAD_REQUEST
            return Response({"detail": "; ".join(exc.messages)}, status=http)

        currency = session.currency
        # La moneda ya fue validada contra los perfiles del juego en el servicio.
        profile = game.bet_profiles.filter(currency=currency, is_active=True).first()
        bet = {
            "default": profile.default_bet if profile else 100,
            "min": profile.min_bet if profile else 1,
            "max": profile.max_bet if profile else 10 ** 12,
            "levels": profile.bet_levels if profile else [],
        }
        cur = Currency.objects.filter(code=currency).first()
        token = make_session_token(session)
        # Base del embed: si es ruta relativa (p. ej. "/embed"), se resuelve contra el
        # host:puerto de esta petición → el iframe sale del mismo origen donde vive la app
        # (dinámico, respeta X-Forwarded-Host/Port). Si es absoluta, se usa tal cual.
        embed_base = settings.EMBED_BASE_URL
        if embed_base.startswith("/"):
            embed_base = f"{_public_origin(request)}{embed_base}"
        return Response(
            {
                "game_session": session.id,
                # Token para el IFRAME: el operador lo pasa a la URL del embed; el
                # navegador tira con este token, no con la API key del operador.
                "session_token": token,
                # URL lista para incrustar: <iframe src="embed_url">. El operador no
                # necesita construir nada, solo ponerla en un iframe.
                "embed_url": f"{embed_base}?t={token}",
                "game": game.slug,
                "grid": {"cols": game.grid_cols, "rows": game.grid_rows},
                "win_mode": game.win_mode,
                "currency": currency,
                "currency_detail": {
                    "code": currency,
                    "exponent": cur.exponent if cur else 2,
                    "symbol": cur.symbol if cur else "$",
                },
                "bet": bet,
                "balance": session.player_session.demo_balance,
                "theme": build_theme(game),
                "paytable": build_paytable(game),
            }
        )


def _spin_payload(outcome, currency, meta):
    """Cuerpo común de respuesta de un tiro, incluyendo estado de tiradas gratis."""
    return {
        "matrix": outcome.matrix,
        "base_win": outcome.base_win,
        "jackpot_win": outcome.jackpot_win,
        "total_win": outcome.total_win,
        "jackpot_triggered": outcome.jackpot_triggered,
        "winning_lines": outcome.winning_lines_json(),
        "currency": currency,
        # Tiradas gratis
        "scatter_count": outcome.scatter_count,
        "free_spins_triggered": outcome.free_spins_triggered,
        "free_spins_awarded": outcome.free_spins_awarded,
        "win_multiplier": outcome.win_multiplier,
        "in_free_spins": meta.get("in_free_spins", False),
        "free_spins_remaining": meta.get("free_spins_remaining", 0),
        # Tiradas gratis OTORGADAS (bonus) que le quedan al jugador en este slot.
        "free_rounds_remaining": meta.get("free_rounds_remaining", 0),
        # Apuesta realmente jugada (difiere de la pedida si fue ronda gratis otorgada).
        "bet_amount": meta.get("bet_amount"),
    }


def _bet_config(game, currency):
    profile = game.bet_profiles.filter(currency=currency, is_active=True).first()
    return {
        "default": profile.default_bet if profile else 100,
        "min": profile.min_bet if profile else 1,
        "max": profile.max_bet if profile else 10 ** 12,
        "levels": profile.bet_levels if profile else [],
    }


def _host_has_port(host):
    """¿El host ya incluye puerto? (cuida IPv6 '[::1]:8080' vs '[::1]')."""
    return host.rfind(":") > host.rfind("]")


def _public_origin(request):
    """
    Origen público (esquema://host[:puerto]) por donde REALMENTE se llega a la app, para
    construir URLs absolutas que consume el operador desde otro origen. Es dinámico: sigue
    al host/puerto de la petición, sin hardcodear el puerto.

    Detrás de un proxy/gateway, `build_absolute_uri` mete el puerto solo si viene dentro del
    Host header; si el gateway reenvía el Host sin puerto pero manda X-Forwarded-Port, Django
    NO lo añade. Aquí sí lo añadimos (cuando USE_X_FORWARDED_PORT está activo). PUBLIC_BASE_URL
    sigue disponible como override explícito.
    """
    if settings.PUBLIC_BASE_URL:
        return settings.PUBLIC_BASE_URL
    scheme = request.scheme  # respeta SECURE_PROXY_SSL_HEADER (X-Forwarded-Proto)
    host = request.get_host()  # respeta USE_X_FORWARDED_HOST; puede traer o no el puerto
    if not _host_has_port(host) and settings.USE_X_FORWARDED_PORT:
        xf_port = request.META.get("HTTP_X_FORWARDED_PORT")
        default = "443" if scheme == "https" else "80"
        if xf_port and xf_port != default:
            host = f"{host}:{xf_port}"
    return f"{scheme}://{host}"


def _public_media_url(request, fieldfile):
    """URL absoluta de un archivo de media para consumo EXTERNO (operador en otro origen)."""
    if not fieldfile:
        return None
    return f"{_public_origin(request)}{fieldfile.url}"


class ProviderGamesView(APIView):
    """
    GET /api/v1/provider/games/  (operador externo, autenticado por API key)

    Catálogo que el operador puede ofrecer: SOLO los juegos que tiene asignados y
    habilitados. El operador guarda esta lista de su lado y renderiza su lobby; el
    `slug` es el id estable que luego manda en /provider/launch/ para abrir la sesión.

    Cabecera: Authorization: Api-Key <clave del operador>
    """

    permission_classes = [HasOperatorApiKey]

    def get(self, request):
        assignments = (
            OperatorGame.objects.filter(operator=request.operator, is_enabled=True)
            .select_related("game")
            .order_by("sort_order", "id")
        )
        out = []
        for og in assignments:
            g = og.game
            if not g.is_active:
                continue
            currencies = sorted(
                g.bet_profiles.filter(is_active=True).values_list("currency", flat=True)
            )
            out.append({
                "slug": g.slug,
                "title": g.title or g.name,
                "description": g.description,
                "grid": {"cols": g.grid_cols, "rows": g.grid_rows},
                "win_mode": g.win_mode,
                "background_color": g.background_color,
                # URL absoluta para que el operador (otro origen) pueda mostrar la imagen.
                "thumbnail": _public_media_url(request, g.thumbnail),
                "currencies": currencies,
            })
        return Response(out)


def _grant_row(grant):
    return {
        "id": str(grant.id),
        "game": grant.game.slug,
        "game_title": grant.game.title or grant.game.name,
        "currency": grant.currency,
        "player": grant.external_player_id or (grant.player_user.email if grant.player_user_id else ""),
        "operator": grant.operator.code if grant.operator_id else None,
        "bet_amount": grant.bet_amount,
        "total": grant.total,
        "remaining": grant.remaining,
        "win_multiplier": grant.win_multiplier,
        "status": grant.status,
        "expires_at": grant.expires_at.isoformat() if grant.expires_at else None,
        "note": grant.note,
        "created_at": grant.created_at.isoformat(),
    }


class ProviderFreeRoundsView(APIView):
    """
    POST /api/v1/provider/free-rounds/  (operador externo, autenticado por API key)

    Concede tiradas gratis a UNO de sus jugadores (por `player_id`) en un juego que
    tenga ASIGNADO. Las rondas no cobran apuesta pero SÍ acreditan premios reales.

    Cabecera: Authorization: Api-Key <clave del operador>
    Body: {"game":"<slug>","player_id":"<id>","currency":"USD","quantity":10,
           "bet_amount":100, "win_multiplier":1, "expires_at":"2026-12-31T23:59:59Z"}
    """

    permission_classes = [HasOperatorApiKey]

    def post(self, request):
        ser = ProviderFreeRoundSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        game = get_object_or_404(Game, slug=d["game"], is_active=True)
        if not OperatorGame.objects.filter(
            operator=request.operator, game=game, is_enabled=True
        ).exists():
            return Response(
                {"detail": "El juego no está asignado a este operador."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            grant = grant_free_rounds(
                game=game, currency=d["currency"], quantity=d["quantity"],
                operator=request.operator, external_player_id=d["player_id"],
                bet_amount=d.get("bet_amount"), win_multiplier=d.get("win_multiplier", 1),
                expires_at=d.get("expires_at"),
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_grant_row(grant), status=status.HTTP_201_CREATED)


class MasterFreeRoundsView(APIView):
    """(Master) Lista y concede tiradas gratis a jugadores (de operador o internos)."""

    permission_classes = [IsMaster]

    def get(self, request):
        qs = FreeRoundGrant.objects.select_related("game", "operator", "player_user").order_by("-created_at")
        code = request.query_params.get("operator")
        if code:
            qs = qs.filter(operator__code=code)
        return paginate(request, qs, _grant_row)

    def post(self, request):
        ser = FreeRoundGrantSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        game = get_object_or_404(Game, slug=d["game"], is_active=True)

        operator = None
        external_player_id = ""
        player_user = None
        if d.get("operator_code") and d.get("external_player_id"):
            operator = get_object_or_404(Operator, code=d["operator_code"])
            external_player_id = d["external_player_id"]
            # El master solo puede conceder en juegos ASIGNADos a ese operador.
            if not OperatorGame.objects.filter(operator=operator, game=game, is_enabled=True).exists():
                return Response(
                    {"detail": "El juego no está asignado a ese operador."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            player_user = User.objects.filter(email__iexact=d["player_email"]).first()
            if player_user is None:
                return Response(
                    {"detail": f"No hay jugador interno con email {d['player_email']}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            grant = grant_free_rounds(
                game=game, currency=d["currency"], quantity=d["quantity"],
                operator=operator, external_player_id=external_player_id, player_user=player_user,
                bet_amount=d.get("bet_amount"), win_multiplier=d.get("win_multiplier", 1),
                expires_at=d.get("expires_at"), note=d.get("note", ""),
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_grant_row(grant), status=status.HTTP_201_CREATED)


class EmbedStateView(APIView):
    """
    GET /api/v1/embed/state/  (iframe, autenticado por session token)

    El iframe se autocarga: con el token resuelve su sesión y recibe todo lo necesario
    para renderizar (tema, rejilla, apuestas, paytable, saldo). Sin login ni API key.
    """

    # El session token es NUESTRO (no SimpleJWT). Desactivamos la auth por defecto
    # para que JWTAuthentication no intercepte el header Bearer y lo rechace.
    authentication_classes = []
    permission_classes = [HasSessionToken]

    def get(self, request):
        session = request.game_session
        game = session.game
        currency = session.currency
        cur = Currency.objects.filter(code=currency).first()
        return Response({
            "game": game.slug,
            "grid": {"cols": game.grid_cols, "rows": game.grid_rows},
            "win_mode": game.win_mode,
            "currency": currency,
            "currency_detail": {
                "code": currency,
                "exponent": cur.exponent if cur else 2,
                "symbol": cur.symbol if cur else "$",
            },
            "bet": _bet_config(game, currency),
            "balance": session.player_session.demo_balance,
            "theme": build_theme(game),
            "paytable": build_paytable(game),
        })


class EmbedSpinView(APIView):
    """
    POST /api/v1/embed/spin/  (iframe, autenticado por session token)

    Tira sobre la sesión del token. Debita/acredita el saldo DEMO de la PlayerSession
    (fun-money) y devuelve el resultado + saldo. Body: {"bet_amount": <int>}.
    """

    authentication_classes = []
    permission_classes = [HasSessionToken]

    def post(self, request):
        ser = EmbedSpinSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        bet = ser.validated_data["bet_amount"]
        idem = ser.validated_data["idempotency_key"] or f"embed-{uuid.uuid4()}"
        session = request.game_session

        seamless = session.player_session.operator.wallet_mode == WalletMode.SEAMLESS

        try:
            if seamless:
                # El saldo real vive en el operador: execute_spin llama a su billetera
                # (debit/credit) y devuelve el saldo real en meta['wallet_balance'].
                spin, outcome, meta = execute_spin(
                    game_session=session, bet_amount=bet, idempotency_key=idem
                )
                balance = meta.get("wallet_balance")
            else:
                # Demo (fun-money): saldo interno; no se cobra en tiradas gratis.
                is_free, _ = free_spins_precontext(session)
                charge = 0 if is_free else bet
                with transaction.atomic():
                    ps = PlayerSession.objects.select_for_update().get(pk=session.player_session_id)
                    if ps.demo_balance < charge:
                        return Response(
                            {"detail": "Saldo insuficiente.", "code": "insufficient_funds"},
                            status=status.HTTP_402_PAYMENT_REQUIRED,
                        )
                    spin, outcome, meta = execute_spin(
                        game_session=session, bet_amount=bet, idempotency_key=idem
                    )
                    ps.demo_balance = ps.demo_balance - charge + outcome.total_win
                    ps.save(update_fields=["demo_balance"])
                balance = ps.demo_balance
        except InsufficientWalletFunds:
            return Response(
                {"detail": "Saldo insuficiente.", "code": "insufficient_funds"},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        except WalletError as exc:
            return Response({"detail": f"Billetera del operador: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)
        except (ValidationError, RTPConfigError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "spin_id": spin.id,
            **_spin_payload(outcome, session.currency, meta),
            "balance": balance,
        })


class LaunchView(APIView):
    """
    POST /api/v1/play/launch/  (jugador autenticado)

    Abre una sesión de juego interna para el jugador y devuelve el estado inicial
    (dimensiones de la rejilla, modo, saldo). Body: {"game": "<slug>"}.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        wallet = getattr(request.user, "wallet", None)
        if wallet is None:
            return Response(
                {"detail": "Solo los jugadores pueden lanzar el juego."},
                status=status.HTTP_403_FORBIDDEN,
            )
        req = LaunchSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        game = get_object_or_404(Game, slug=req.validated_data["game"], is_active=True)
        session = launch_internal_session(user=request.user, game=game)

        # Moneda a mostrar: ?currency/?country del consumidor > IP > moneda del wallet.
        available = set(
            game.bet_profiles.filter(is_active=True).values_list("currency", flat=True)
        )
        currency, source = resolve_currency(request, available, default=wallet.currency)

        profile = (
            game.bet_profiles.filter(currency=currency, is_active=True).first()
            or game.bet_profiles.filter(currency=wallet.currency, is_active=True).first()
            or game.bet_profiles.filter(is_active=True).first()
        )
        bet = {
            "default": profile.default_bet if profile else 100,
            "min": profile.min_bet if profile else 1,
            "max": profile.max_bet if profile else 10 ** 12,
            "levels": profile.bet_levels if profile else [],
        }
        cur = Currency.objects.filter(code=currency).first()
        return Response(
            {
                "game_session": session.id,
                "game": game.slug,
                "grid": {"cols": game.grid_cols, "rows": game.grid_rows},
                "win_mode": game.win_mode,
                "balance": wallet.balance,
                "currency": currency,
                "currency_source": source,
                "currency_detail": {
                    "code": currency,
                    "exponent": cur.exponent if cur else 2,
                    "symbol": cur.symbol if cur else "$",
                },
                "bet": bet,
                "theme": build_theme(game),
                "paytable": build_paytable(game),
            }
        )


class PlaySpinView(APIView):
    """
    POST /api/v1/play/spin/  (jugador autenticado)

    Tira contra el monedero interno del jugador. Verifica que la sesión sea suya.
    Body: {"game_session": "<uuid>", "bet_amount": <int céntimos>}.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        req = PlaySpinSerializer(data=request.data)
        req.is_valid(raise_exception=True)
        data = req.validated_data

        session = get_object_or_404(
            GameSession, id=data["game_session"], player_user=request.user, is_open=True
        )
        try:
            spin, outcome, meta = execute_internal_spin(
                game_session=session, bet_amount=data["bet_amount"]
            )
        except InsufficientFunds as exc:
            return Response(
                {"detail": str(exc), "code": "insufficient_funds"},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        except (ValidationError, RTPConfigError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        wallet = request.user.wallet
        wallet.refresh_from_db()
        return Response(
            {
                "spin_id": spin.id,
                **_spin_payload(outcome, session.currency, meta),
                "balance": wallet.balance,
            },
            status=status.HTTP_200_OK,
        )


class GamePaytableView(APIView):
    """Tabla de pagos de un juego (para el '?'; sirve para cualquier casino)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        game = get_object_or_404(Game, slug=slug, is_active=True)
        return Response(build_paytable(game))


class GamesLobbyView(APIView):
    """Juegos activos disponibles para jugar (lobby del jugador)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        games = Game.objects.filter(is_active=True, is_template=False).order_by("name")
        return Response(
            [
                {
                    "slug": g.slug,
                    "title": g.title or g.name,
                    "grid": {"cols": g.grid_cols, "rows": g.grid_rows},
                    "win_mode": g.win_mode,
                    "thumbnail": g.thumbnail.url if g.thumbnail else None,
                    "background_color": g.background_color,
                }
                for g in games
            ]
        )


# Campos de asset del juego cuya URL actual se expone al editor (para previsualizar
# lo que ya está subido). Incluye imágenes y ficheros (audio/vídeo).
_GAME_ASSET_FIELDS = sorted(GAME_IMAGE_FIELDS | GAME_FILE_FIELDS)


def _url(fieldfile):
    """URL del FileField/ImageField o None si está vacío."""
    return fieldfile.url if fieldfile else None


def _game_row(game):
    syms = list(game.symbols.all())
    with_asset = sum(1 for s in syms if s.image)
    rtp_cfg = game.rtp_configurations.filter(operator__isnull=True, is_active=True).first()
    return {
        "slug": game.slug,
        "name": game.name,
        "title": game.title,
        "win_mode": game.win_mode,
        "target_rtp": str(rtp_cfg.target_rtp) if rtp_cfg else None,
        "grid": {"cols": game.grid_cols, "rows": game.grid_rows},
        "is_active": game.is_active,
        "background_color": game.background_color,
        "accent_color": game.accent_color,
        "background_type": game.background_type,
        "background_gradient": game.background_gradient,
        "thumbnail": _url(game.thumbnail),
        "symbols": len(syms),
        "assets": with_asset,
        "symbol_codes": [s.code for s in syms],
        # Imagen ACTUAL de cada símbolo (para previsualizar en el editor).
        "symbol_assets": {s.code: _url(s.image) for s in syms},
        # URL ACTUAL de cada asset del juego (None si no se ha subido).
        "asset_urls": {f: _url(getattr(game, f)) for f in _GAME_ASSET_FIELDS},
    }


class MasterGamesView(APIView):
    """(Master) Lista y crea casinos (juegos) clonando una plantilla."""

    permission_classes = [IsMaster]

    def get(self, request):
        return Response([_game_row(g) for g in Game.objects.all().order_by("name")])

    def post(self, request):
        ser = GameCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if Game.objects.filter(slug=d["slug"]).exists():
            return Response(
                {"detail": "Ya existe un juego con ese slug."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            game = create_game_from_template(
                template_slug=d["template"], name=d["name"], slug=d["slug"],
                title=d.get("title", ""), background_color=d.get("background_color", "#0b0f1a"),
            )
        except Game.DoesNotExist:
            return Response(
                {"detail": f"Plantilla '{d['template']}' no encontrada."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(_game_row(game), status=status.HTTP_201_CREATED)


class GameBuildView(APIView):
    """(Master) Crea un casino TOTALMENTE CONFIGURABLE desde una especificación."""

    permission_classes = [IsMaster]

    def post(self, request):
        ser = GameBuildSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        spec = ser.validated_data
        if Game.objects.filter(slug=spec["slug"]).exists():
            return Response(
                {"detail": "Ya existe un juego con ese slug."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            game = create_configurable_game(spec=spec)
        except (ValidationError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_game_row(game), status=status.HTTP_201_CREATED)


class GameDetailView(APIView):
    """(Master) Borra un casino. Solo si NO tiene giros (la auditoría es inmutable).

    Borra en cascada su configuración (símbolos, pagos, bandas, líneas, apuestas,
    jackpot, tiradas gratis). Las FKs PROTECT (RTPConfiguration, GameSession) se
    limpian explícitamente antes. Si el casino ya se jugó, se rechaza: desactívalo.
    """

    permission_classes = [IsMaster]

    def delete(self, request, slug):
        from django.db import transaction

        from app_rtp.models import RTPConfiguration

        game = get_object_or_404(Game, slug=slug)
        if Spin.objects.filter(game=game).exists():
            return Response(
                {"detail": "El casino tiene giros registrados; no se puede borrar. "
                           "Desactívalo para dejar de ofrecerlo (la auditoría es inmutable)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            GameSession.objects.filter(game=game).delete()   # sin giros: seguro
            RTPConfiguration.objects.filter(game=game).delete()
            game.delete()   # cascada: símbolos, pagos, bandas, líneas, apuestas, etc.
        return Response(status=status.HTTP_204_NO_CONTENT)


class GameSimulateView(APIView):
    """(Master) Simula el RTP (Monte Carlo) para verificar la configuración."""

    permission_classes = [IsMaster]

    def post(self, request, slug):
        game = get_object_or_404(Game, slug=slug)
        ser = SimulateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            res = simulate_game_rtp(
                game, spins=ser.validated_data["spins"], bet_amount=ser.validated_data["bet_amount"]
            )
        except (ValidationError, RTPConfigError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(res)


class GameAssetView(APIView):
    """(Master) Sube un asset de nivel de juego (logo, fondo, botones, música…)."""

    permission_classes = [IsMaster]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, slug, field):
        if field not in GAME_IMAGE_FIELDS and field not in GAME_FILE_FIELDS:
            return Response({"detail": f"Campo no permitido: {field}."}, status=status.HTTP_400_BAD_REQUEST)
        game = get_object_or_404(Game, slug=slug)
        file = request.FILES.get("file") or request.FILES.get("image")
        if not file:
            return Response({"detail": "Falta el archivo 'file'."}, status=status.HTTP_400_BAD_REQUEST)
        getattr(game, field).save(file.name, file, save=True)
        # Al subir un fondo, activa el tipo correcto para que se use al vuelo sin que el
        # master tenga que tocar el selector "tipo de fondo" (fuente de confusión).
        if field == "background_video" and game.background_type != BackgroundType.VIDEO:
            game.background_type = BackgroundType.VIDEO
            game.save(update_fields=["background_type"])
        elif field == "background_image" and game.background_type in (
            BackgroundType.COLOR, BackgroundType.GRADIENT
        ):
            game.background_type = BackgroundType.IMAGE
            game.save(update_fields=["background_type"])
        return Response({"field": field, "url": getattr(game, field).url})


class GameThemeView(APIView):
    """(Master) Edita el TEMA visual de un casino existente (colores, fondo, título).

    Solo campos de presentación — NO toca la matemática (bandas, RTP, paytable), así
    que no afecta la certificación. Body: cualquier subconjunto de
    {title, background_color, accent_color, background_type, background_gradient}.
    """

    permission_classes = [IsMaster]

    def patch(self, request, slug):
        game = get_object_or_404(Game, slug=slug)
        ser = GameThemeSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        # target_rtp y el tamaño de rejilla NO son campos simples del juego: disparan
        # recalibración (y, en el resize, regeneran bandas/líneas). Pueden tardar unos
        # segundos por la simulación de cuadre.
        new_rtp = data.pop("target_rtp", None)
        new_cols = data.pop("grid_cols", None)
        new_rows = data.pop("grid_rows", None)
        for field, value in data.items():
            setattr(game, field, value)
        if data:
            game.save(update_fields=list(data.keys()))
        # Resize primero (regenera matemática); luego RTP si además lo cambiaron.
        cols = new_cols if new_cols is not None else game.grid_cols
        rows = new_rows if new_rows is not None else game.grid_rows
        if (new_cols is not None and new_cols != game.grid_cols) or (
            new_rows is not None and new_rows != game.grid_rows
        ):
            resize_game(game, grid_cols=cols, grid_rows=rows)
        if new_rtp is not None:
            set_game_target_rtp(game, new_rtp)
        return Response(_game_row(game))


class CurrenciesView(APIView):
    """Catálogo de monedas soportadas (para el builder)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            [
                {"code": c.code, "name": c.name, "exponent": c.exponent, "symbol": c.symbol}
                for c in Currency.objects.filter(is_active=True)
            ]
        )


class SymbolAssetView(APIView):
    """(Master) Sube el sprite de un símbolo de un juego (reskin)."""

    permission_classes = [IsMaster]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, slug, code):
        game = get_object_or_404(Game, slug=slug)
        symbol = get_object_or_404(Symbol, game=game, code=code)
        file = request.FILES.get("image")
        if not file:
            return Response({"detail": "Falta el archivo 'image'."}, status=status.HTTP_400_BAD_REQUEST)
        symbol.image = file
        symbol.save(update_fields=["image"])
        return Response({"code": code, "image_url": symbol.image.url})


# --------------------------------------------------------------------------- #
# (Master) Gestión de OPERADORES: alta, API keys, catálogo y jugadas aisladas. #
# --------------------------------------------------------------------------- #
def _operator_row(operator):
    players = (
        PlayerSession.objects.filter(operator=operator)
        .values("external_player_id").distinct().count()
    )
    return {
        "code": operator.code,
        "name": operator.name,
        "is_active": operator.is_active,
        "games": operator.games.filter(is_enabled=True).count(),
        "keys": operator.api_keys.filter(is_active=True).count(),
        "players": players,
        "wallet_mode": operator.wallet_mode,
        "wallet_base_url": operator.wallet_base_url or "",
        "created_at": operator.created_at.isoformat(),
    }


def _usd(value):
    """Decimal (dólares) -> float con 2 decimales para JSON."""
    return float(round(value, 2))


class MasterOperatorsView(APIView):
    """(Master) Lista y da de alta operadores (casinos que consumen el catálogo)."""

    permission_classes = [IsMaster]

    def get(self, request):
        return Response([_operator_row(o) for o in Operator.objects.all().order_by("name")])

    def post(self, request):
        ser = OperatorCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if Operator.objects.filter(code=d["code"]).exists():
            return Response(
                {"detail": "Ya existe un operador con ese código."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        operator = Operator.objects.create(
            name=d["name"], code=d["code"],
            wallet_base_url=d["wallet_base_url"] or "https://demo.invalid/wallet",
        )
        return Response(_operator_row(operator), status=status.HTTP_201_CREATED)


class OperatorKeysView(APIView):
    """
    (Master) API keys de un operador.
    GET: lista claves (sin el secreto). POST: genera una nueva y devuelve el secreto
    UNA sola vez (no se puede volver a ver).
    """

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(
            [
                {
                    "prefix": k.prefix, "label": k.label, "is_active": k.is_active,
                    "last_used_at": k.last_used_at, "created_at": k.created_at,
                }
                for k in operator.api_keys.order_by("-created_at")
            ]
        )

    def post(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        ser = ApiKeyCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        raw, key = generate_api_key(operator, label=ser.validated_data["label"])
        # `api_key` en claro: se muestra AQUÍ y no vuelve a estar disponible.
        return Response(
            {"api_key": raw, "prefix": key.prefix, "label": key.label},
            status=status.HTTP_201_CREATED,
        )


def _webhook_secret_status(operator):
    """
    Estado del secreto HMAC del webhook de un operador, para el Master.
    `webhook_hmac_secret_ref` guarda una REFERENCIA (nombre de env var, recomendado) o
    el valor literal; `resolve_wallet_secret` devuelve el valor resuelto para revelar.
    """
    ref = (operator.webhook_hmac_secret_ref or "").strip()
    secret = resolve_wallet_secret(operator)
    return {
        "ref": ref,
        # ¿El ref es el NOMBRE de una env var definida en el servidor? (camino seguro)
        "is_env_var": bool(ref) and ref in os.environ,
        "configured": bool(secret),
        "secret": secret or "",
        "wallet_mode": operator.wallet_mode,
        "seamless": operator.wallet_mode == WalletMode.SEAMLESS,
    }


class OperatorWebhookSecretView(APIView):
    """
    (Master) Secreto HMAC del webhook del operador (cabecera X-SlotForge-Signature).
    GET: estado + valor resuelto (para revelar/copiar). PUT: fija la referencia
    (nombre de env var recomendado, o valor literal). El valor real vive en el .env.
    """

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(_webhook_secret_status(operator))

    def put(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        ser = WebhookSecretRefSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        operator.webhook_hmac_secret_ref = ser.validated_data["ref"].strip()
        operator.save(update_fields=["webhook_hmac_secret_ref"])
        return Response(_webhook_secret_status(operator))


def _wallet_endpoints(base):
    """Los 3 endpoints concretos del webhook que Bufonbet/SlotForge llamará."""
    base = (base or "").rstrip("/")
    if not base:
        return {"debit": "", "credit": "", "rollback": ""}
    return {a: f"{base}/slotforge/wallet/{a}/" for a in ("debit", "credit", "rollback")}


def _wallet_config(operator):
    return {
        "wallet_mode": operator.wallet_mode,
        "wallet_base_url": operator.wallet_base_url or "",
        "endpoints": _wallet_endpoints(operator.wallet_base_url),
    }


class OperatorWalletConfigView(APIView):
    """
    (Master) Modo de billetera y URL base del webhook del operador. Bufonbet/SlotForge
    llamará a <wallet_base_url>/slotforge/wallet/{debit,credit,rollback}/.
    """

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(_wallet_config(operator))

    def put(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        ser = WalletConfigSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        operator.wallet_mode = ser.validated_data["wallet_mode"]
        operator.wallet_base_url = (ser.validated_data.get("wallet_base_url") or "").strip()
        operator.save(update_fields=["wallet_mode", "wallet_base_url"])
        return Response(_wallet_config(operator))


class OperatorUsersView(APIView):
    """
    (Master) Cuentas de ACCESO (login) de un operador para su back office.
    GET: lista las cuentas. POST: crea una nueva {email, password}.
    """

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        accounts = Profile.objects.filter(
            role=Role.OPERATOR, operator=operator
        ).select_related("user")
        return Response([
            {"id": p.user_id, "email": p.user.email or p.user.username}
            for p in accounts
        ])

    def post(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        ser = OperatorUserCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        email = ser.validated_data["email"].lower()
        password = ser.validated_data["password"]
        if User.objects.filter(username=email).exists():
            return Response({"detail": "Ya existe un usuario con ese email."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, password=password)
            Profile.objects.create(user=user, role=Role.OPERATOR, operator=operator)
        return Response({"id": user.id, "email": email}, status=status.HTTP_201_CREATED)


class OperatorUserPasswordView(APIView):
    """(Master) Cambia la contraseña de una cuenta de acceso del operador."""

    permission_classes = [IsMaster]

    def post(self, request, code, user_id):
        operator = get_object_or_404(Operator, code=code)
        # La cuenta debe pertenecer a ESTE operador (no se toca a otros).
        get_object_or_404(Profile, user_id=user_id, role=Role.OPERATOR, operator=operator)
        ser = OperatorPasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = User.objects.get(pk=user_id)
        user.set_password(ser.validated_data["password"])
        user.save(update_fields=["password"])
        return Response({"id": user_id, "detail": "Contraseña actualizada."})


class OperatorGamesView(APIView):
    """
    (Master) Catálogo de un operador: qué juegos puede ofrecer.
    GET: todos los juegos con su estado (asignado/habilitado) para ese operador.
    POST: asigna/actualiza {game, is_enabled}. is_enabled=false lo deshabilita.
    """

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        assigned = {
            og.game_id: og for og in operator.games.all()
        }
        rows = []
        for g in Game.objects.filter(is_active=True).order_by("name"):
            og = assigned.get(g.id)
            rows.append({
                "slug": g.slug, "title": g.title or g.name,
                "grid": {"cols": g.grid_cols, "rows": g.grid_rows}, "win_mode": g.win_mode,
                "assigned": og is not None,
                "is_enabled": bool(og and og.is_enabled),
            })
        return Response(rows)

    def post(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        ser = OperatorGameAssignSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        game = get_object_or_404(Game, slug=ser.validated_data["game"])
        og, _ = OperatorGame.objects.update_or_create(
            operator=operator, game=game,
            defaults={"is_enabled": ser.validated_data["is_enabled"]},
        )
        return Response(
            {"game": game.slug, "assigned": True, "is_enabled": og.is_enabled}
        )


def _operator_summary(operator):
    """Resumen de un operador: totales por moneda + consolidado en USD. Reutilizado
    por el panel master y por el back office del propio operador."""
    spins = Spin.objects.filter(game_session__player_session__operator=operator)
    totals = (
        spins.values("currency")
        .annotate(spins=Count("id"), bet=Sum("bet_amount"), win=Sum("win_amount"))
        .order_by("currency")
    )
    by_currency = [
        {
            "currency": t["currency"], "spins": t["spins"],
            "bet": t["bet"] or 0, "win": t["win"] or 0,
            "ggr": (t["bet"] or 0) - (t["win"] or 0),
        }
        for t in totals
    ]
    usd, missing = convert_currency_totals(by_currency)
    return {
        "operator": operator.code,
        "by_currency": by_currency,
        "usd": {"bet": _usd(usd["bet"]), "win": _usd(usd["win"]), "ggr": _usd(usd["ggr"])},
        "usd_missing_rate": missing,
    }


def _operator_spins_response(request, operator):
    """Giros de un operador, paginados. Reutilizado por master y back office."""
    qs = (
        Spin.objects.filter(game_session__player_session__operator=operator)
        .select_related("game", "game_session__player_session")
        .order_by("-created_at")
    )

    def serialize(spins):
        return [
            {
                "spin_id": s.id, "game": s.game.slug,
                "player": s.game_session.player_session.external_player_id
                if s.game_session.player_session else "—",
                "bet_amount": s.bet_amount, "win_amount": s.win_amount,
                "currency": s.currency, "created_at": s.created_at,
            }
            for s in spins
        ]

    return paginate(request, qs, serialize)


def _operator_players_response(request, operator):
    """
    Jugadores de un operador (por external_player_id), paginados, con sus agregados
    convertidos a USD. Un jugador puede tener varias monedas: se consolidan a USD.
    """
    players_qs = (
        PlayerSession.objects.filter(operator=operator)
        .values_list("external_player_id", flat=True)
        .distinct()
        .order_by("external_player_id")
    )

    def serialize(ids):
        if not ids:
            return []
        # Un solo agregado por (jugador, moneda) para toda la página.
        rows = (
            Spin.objects.filter(
                game_session__player_session__operator=operator,
                game_session__player_session__external_player_id__in=ids,
            )
            .values("game_session__player_session__external_player_id", "currency")
            .annotate(spins=Count("id"), bet=Sum("bet_amount"), win=Sum("win_amount"))
        )
        per_player: dict = {pid: [] for pid in ids}
        for r in rows:
            pid = r["game_session__player_session__external_player_id"]
            bet, win = r["bet"] or 0, r["win"] or 0
            per_player.setdefault(pid, []).append(
                {"currency": r["currency"], "spins": r["spins"], "bet": bet, "win": win, "ggr": bet - win}
            )
        out = []
        for pid in ids:
            cur = per_player.get(pid, [])
            usd, missing = convert_currency_totals(cur)
            out.append({
                "player": pid,
                "spins": sum(c["spins"] for c in cur),
                "currencies": sorted(c["currency"] for c in cur),
                # Desglose EN LA MONEDA del jugador (unidades menores), para mostrar los
                # importes tal cual, además del consolidado en USD.
                "by_currency": sorted(cur, key=lambda c: c["currency"]),
                "usd": {"bet": _usd(usd["bet"]), "win": _usd(usd["win"]), "ggr": _usd(usd["ggr"])},
                "usd_missing_rate": missing,
            })
        return out

    return paginate(request, players_qs, serialize)


class OperatorPlaysView(APIView):
    """(Master) Resumen (totales por moneda + USD) de UN operador."""

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(_operator_summary(operator))


class OperatorPlayersView(APIView):
    """(Master) Jugadores de un operador, paginados (con agregados en USD)."""

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(_operator_players_response(request, operator))


class OperatorSpinsView(APIView):
    """(Master) Giros de un operador, PAGINADOS (?page, ?page_size)."""

    permission_classes = [IsMaster]

    def get(self, request, code):
        operator = get_object_or_404(Operator, code=code)
        return Response(_operator_spins_response(request, operator))


# --------------------------------------------------------------------------- #
# BACK OFFICE del OPERADOR: el propio operador (login) ve SOLO sus datos.       #
# --------------------------------------------------------------------------- #
class OperatorMeView(APIView):
    """(Operador) Resumen de MI operador (el de mi cuenta). Aislado."""

    permission_classes = [IsOperatorUser]

    def get(self, request):
        data = _operator_summary(request.operator)
        data["name"] = request.operator.name
        return Response(data)


class OperatorMeSpinsView(APIView):
    """(Operador) Giros de MI operador, paginados. Aislado."""

    permission_classes = [IsOperatorUser]

    def get(self, request):
        return Response(_operator_spins_response(request, request.operator))


class OperatorMePlayersView(APIView):
    """(Operador) MIS jugadores, paginados. Aislado."""

    permission_classes = [IsOperatorUser]

    def get(self, request):
        return Response(_operator_players_response(request, request.operator))


class OperatorMeWebhookSecretView(APIView):
    """
    (Operador) MI secreto HMAC del webhook, SOLO LECTURA — para copiarlo y verificar
    con él las llamadas firmadas (X-SlotForge-Signature) en mi billetera. No expone la
    referencia interna (nombre de env var), solo el valor a usar.
    """

    permission_classes = [IsOperatorUser]

    def get(self, request):
        op = request.operator
        secret = resolve_wallet_secret(op)
        return Response({
            "configured": bool(secret),
            "secret": secret or "",
            "seamless": op.wallet_mode == WalletMode.SEAMLESS,
            "wallet_base_url": op.wallet_base_url or "",
            # Los endpoints que Bufonbet/SlotForge llamará en tu billetera.
            "endpoints": _wallet_endpoints(op.wallet_base_url),
        })


class MasterOperatorsReportView(APIView):
    """
    (Master) Overview GLOBAL de todos los operadores, consolidado en USD.

    Para cada operador suma su GGR/apostado/premiado convirtiendo cada moneda a USD
    (última tasa de FxRate). Una sola consulta agrupada por (operador, moneda). Marca
    las monedas sin tasa para no falsear los totales.
    """

    permission_classes = [IsMaster]

    def get(self, request):
        rows = (
            Spin.objects.values(
                "game_session__player_session__operator__code",
                "game_session__player_session__operator__name",
                "currency",
            )
            .annotate(spins=Count("id"), bet=Sum("bet_amount"), win=Sum("win_amount"))
        )
        # Agrupa por operador -> lista de totales por moneda.
        per_op: dict = {}
        for r in rows:
            code = r["game_session__player_session__operator__code"]
            if code is None:
                continue  # spins internos sin operador
            entry = per_op.setdefault(
                code,
                {"name": r["game_session__player_session__operator__name"], "cur": []},
            )
            bet = r["bet"] or 0
            win = r["win"] or 0
            entry["cur"].append({
                "currency": r["currency"], "spins": r["spins"],
                "bet": bet, "win": win, "ggr": bet - win,
            })

        report = []
        grand = {"bet": 0.0, "win": 0.0, "ggr": 0.0, "spins": 0}
        for code, entry in per_op.items():
            usd, missing = convert_currency_totals(entry["cur"])
            spins = sum(c["spins"] for c in entry["cur"])
            row = {
                "code": code, "name": entry["name"], "spins": spins,
                "currencies": sorted(c["currency"] for c in entry["cur"]),
                "usd": {"bet": _usd(usd["bet"]), "win": _usd(usd["win"]), "ggr": _usd(usd["ggr"])},
                "usd_missing_rate": missing,
            }
            report.append(row)
            grand["bet"] += row["usd"]["bet"]
            grand["win"] += row["usd"]["win"]
            grand["ggr"] += row["usd"]["ggr"]
            grand["spins"] += spins

        report.sort(key=lambda x: x["usd"]["ggr"], reverse=True)
        grand = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in grand.items()}
        return Response({"operators": report, "grand_total_usd": grand})
