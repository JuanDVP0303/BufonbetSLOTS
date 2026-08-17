"""
Siembra dos juegos demo listos para jugar (idempotente):
  - demo-lines-3x3 : slot 3x3, 5 líneas fijas (modo LINES) + drop jackpot.
  - demo-ways-5x3  : slot 5x3, 243 ways (modo WAYS).

Crea además operador, jugador y sesiones demo, y mide el RTP empírico de cada
juego con Monte Carlo (la forma correcta de verificar, no de ajustar).

Uso:
    python manage.py seed_demo_game [--spins 300000]
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from app_game.engine import default_3x3_paylines, simulate_rtp
from app_game.models import (
    DropJackpot,
    Game,
    GameBetProfile,
    GameSession,
    Payline,
    ReelStrip,
    Symbol,
    SymbolPayout,
    Volatility,
    WinMode,
)
from app_game.services import build_engine
from app_rtp.models import RTPConfiguration
from app_wallet_integration.models import Operator, PlayerSession
from common.models import Currency

MATH_VERSION = "v1"

SYMBOLS = [
    ("WILD", "Comodín", True),
    ("A", "As", False),
    ("K", "Rey", False),
    ("Q", "Reina", False),
    ("J", "Jota", False),
    ("T", "Diez", False),
]


def build_strip(freq: dict) -> list:
    strip = []
    for symbol, n in freq.items():
        strip.extend([symbol] * n)
    return strip


class Command(BaseCommand):
    help = "Siembra juegos demo (3x3 LINES y 5x3 WAYS) y mide su RTP."

    def add_arguments(self, parser):
        parser.add_argument("--spins", type=int, default=300_000, help="Tiros para medir RTP.")

    @transaction.atomic
    def handle(self, *args, **opts):
        Currency.objects.get_or_create(
            code="USD", defaults=dict(name="US Dollar", exponent=2, symbol="$")
        )
        operator, _ = Operator.objects.get_or_create(
            code="demo-casino",
            defaults=dict(
                name="Demo Casino",
                wallet_base_url="https://demo.local/wallet",
                allowed_iframe_origins=["https://demo.local"],
            ),
        )
        player, _ = PlayerSession.objects.get_or_create(
            operator=operator,
            external_player_id="demo-player-001",
            defaults=dict(currency="USD"),
        )

        lines_game = self._seed_lines_game()
        ways_game = self._seed_ways_game()

        lines_session, _ = GameSession.objects.get_or_create(
            game=lines_game, player_session=player, is_open=True, defaults=dict(currency="USD")
        )
        ways_session, _ = GameSession.objects.get_or_create(
            game=ways_game, player_session=player, is_open=True, defaults=dict(currency="USD")
        )

        # -- Verificación de RTP (Monte Carlo) --------------------------------
        self.stdout.write("\nRTP empírico (declarado en config: 95%):")
        for game in (lines_game, ways_game):
            engine = build_engine(game, MATH_VERSION)
            bet = game.bet_profiles.get(currency="USD").default_bet
            res = simulate_rtp(engine, bet, opts["spins"])
            self.stdout.write(
                f"  {game.slug:16s} RTP={res['rtp']:.2%} "
                f"(base={res['rtp_base']:.2%}, jackpot={res['rtp_jackpot']:.2%}) "
                f"hit={res['hit_rate']:.2%}"
            )

        self.stdout.write(self.style.SUCCESS("\nSesiones demo listas para POST /api/v1/spin/:"))
        self.stdout.write(f"  LINES 3x3  game_session = {lines_session.id}  (bet_amount 100)")
        self.stdout.write(f"  WAYS  5x3  game_session = {ways_session.id}  (bet_amount 100)")

    # ------------------------------------------------------------------ #
    def _seed_symbols(self, game):
        objs = {}
        for code, name, is_wild in SYMBOLS:
            obj, _ = Symbol.objects.get_or_create(
                game=game, code=code,
                defaults=dict(name=name, is_wild=is_wild, asset_key=code.lower()),
            )
            objs[code] = obj
        return objs

    def _seed_lines_game(self):
        game, _ = Game.objects.get_or_create(
            slug="demo-lines-3x3",
            defaults=dict(
                name="Demo Lines 3x3", grid_cols=3, grid_rows=3,
                win_mode=WinMode.LINES, volatility=Volatility.MEDIUM,
                max_win_multiplier=1000, is_active=True,
            ),
        )
        symbols = self._seed_symbols(game)

        for idx, pattern in enumerate(default_3x3_paylines()):
            Payline.objects.get_or_create(game=game, index=idx, defaults=dict(pattern=pattern))

        # Calibrado a ~95% RTP (base ~94% + jackpot ~1%). Ver `simulate_rtp`.
        payouts = {"WILD": "134", "A": "53.5", "K": "26.75", "Q": "13.9", "J": "6.95", "T": "2.68"}
        for code, mult in payouts.items():
            SymbolPayout.objects.update_or_create(
                game=game, symbol=symbols[code], count=3, defaults=dict(multiplier=Decimal(mult))
            )

        freq = {"WILD": 2, "A": 3, "K": 4, "Q": 5, "J": 6, "T": 10}  # 30 por rodillo
        strip = build_strip(freq)
        for reel in range(3):
            ReelStrip.objects.get_or_create(
                game=game, math_version=MATH_VERSION, reel_index=reel, defaults=dict(strip=strip)
            )

        GameBetProfile.objects.get_or_create(
            game=game, currency="USD",
            defaults=dict(min_bet=20, max_bet=50000, default_bet=100,
                          bet_levels=[20, 50, 100, 200, 500], is_active=True),
        )
        DropJackpot.objects.get_or_create(
            game=game,
            defaults=dict(is_active=True, trigger_probability=Decimal("0.00003"),
                          award_amount=100000, currency="USD"),
        )
        RTPConfiguration.objects.get_or_create(
            game=game, operator=None, name="default-95",
            defaults=dict(target_rtp=Decimal("0.9500"), house_margin=Decimal("0.0500"),
                          math_version=MATH_VERSION, is_active=True, effective_from=timezone.now()),
        )
        return game

    def _seed_ways_game(self):
        game, _ = Game.objects.get_or_create(
            slug="demo-ways-5x3",
            defaults=dict(
                name="Demo Ways 5x3", grid_cols=5, grid_rows=3,
                win_mode=WinMode.WAYS, volatility=Volatility.HIGH,
                max_win_multiplier=5000, is_active=True,
            ),
        )
        symbols = self._seed_symbols(game)

        # Calibrado a ~93% RTP (sin jackpot en este juego). Ver `simulate_rtp`.
        payouts = {
            "A": {3: "12.8", 4: "64", 5: "320"},
            "K": {3: "9.6", 4: "51.2", 5: "256"},
            "Q": {3: "6.4", 4: "32", 5: "160"},
            "J": {3: "3.2", 4: "19.2", 5: "96"},
            "T": {3: "1.92", 4: "12.8", 5: "64"},
            "WILD": {5: "640"},
        }
        for code, table in payouts.items():
            for count, mult in table.items():
                SymbolPayout.objects.update_or_create(
                    game=game, symbol=symbols[code], count=count,
                    defaults=dict(multiplier=Decimal(mult)),
                )

        freq = {"WILD": 1, "A": 2, "K": 2, "Q": 3, "J": 3, "T": 4}  # 15 por rodillo
        strip = build_strip(freq)
        for reel in range(5):
            ReelStrip.objects.get_or_create(
                game=game, math_version=MATH_VERSION, reel_index=reel, defaults=dict(strip=strip)
            )

        GameBetProfile.objects.update_or_create(
            game=game, currency="USD",
            defaults=dict(min_bet=20, max_bet=50000, default_bet=100,
                          bet_levels=[20, 50, 100, 200, 500], is_active=True),
        )
        RTPConfiguration.objects.get_or_create(
            game=game, operator=None, name="default-95",
            defaults=dict(target_rtp=Decimal("0.9500"), house_margin=Decimal("0.0500"),
                          math_version=MATH_VERSION, is_active=True, effective_from=timezone.now()),
        )
        return game
