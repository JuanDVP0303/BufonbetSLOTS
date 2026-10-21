"""
Crea el casino "Dulce Fiesta" (5x3 WAYS, tema de caramelos) con matemática propia
(no es un reskin de plantilla: ver create_configurable_game) y le asigna el arte
real del pack en DULCEFIESTA/ (raíz del proyecto). Idempotente: re-ejecutar borra
y recrea la matemática (símbolos/pagos/bandas/RTP) y re-sube los assets.

Este pack es el FORMATO ESTÁNDAR para futuros casinos temáticos: carpetas
FONDO, FONDO CARGA, LOGO, GRILL, ICONOS, BOTONES, BANNER WIN — ver _assign_chrome
y _assign_symbols para el mapeo exacto de cada carpeta a los campos del tema.

Uso:
    python manage.py seed_dulce_fiesta
    python manage.py seed_dulce_fiesta --assets /ruta/al/pack   (opcional)
"""
import os

from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction

from app_game.models import Game, GameBetProfile, GameSession, Symbol
from app_game.services import create_configurable_game
from app_rtp.models import RTPConfiguration

DEFAULT_BASE = str(settings.BASE_DIR / "DULCEFIESTA")

SLUG = "dulce-fiesta"
MATH_VERSION = "v1"

# Símbolos: código -> (nombre, es_wild, es_scatter, peso, archivo en ICONOS/).
SYMBOLS = [
    ("WILD", "Cupcake Comodín", True, False, 1, "ICONOS/ICONO 3.png"),
    ("SCATTER", "Free Games", False, True, 1, "ICONOS/ICONO 2.png"),
    ("SEVEN", "Siete de la Suerte", False, False, 2, "ICONOS/ICONO 8.png"),
    ("GRAPE", "Uva", False, False, 3, "ICONOS/ICONO 9.png"),
    ("STRAWBERRY", "Fresa", False, False, 3, "ICONOS/ICONO 7.png"),
    ("PINEAPPLE", "Piña", False, False, 4, "ICONOS/ICONO 6.png"),
    ("KIWI", "Kiwi", False, False, 4, "ICONOS/ICONO 5.png"),
    ("MANGO", "Mango", False, False, 5, "ICONOS/ICONO 4.png"),
    ("PEACH", "Durazno", False, False, 5, "ICONOS/ICONO 1.png"),
]

# Pagos base (count -> multiplicador de la apuesta total). calibrate_game_rtp
# los reescala después para que el RTP MEDIDO cuadre con target_rtp: solo
# importan las proporciones RELATIVAS entre símbolos, no el valor absoluto.
PAYOUTS = {
    "WILD": {3: "40", 4: "200", 5: "1000"},
    "SEVEN": {3: "15", 4: "75", 5: "375"},
    "GRAPE": {3: "10", 4: "50", 5: "250"},
    "STRAWBERRY": {3: "10", 4: "50", 5: "250"},
    "PINEAPPLE": {3: "6", 4: "30", 5: "150"},
    "KIWI": {3: "6", 4: "30", 5: "150"},
    "MANGO": {3: "4", 4: "20", 5: "100"},
    "PEACH": {3: "4", 4: "20", 5: "100"},
}

# Chrome del casino: campo del modelo Game -> ruta relativa dentro del pack.
CHROME_FIELDS = {
    "background_image": "FONDO/FONDO.png",
    "logo": "LOGO/LOGO.png",
    "grid_frame": "GRILL/GRILL.png",
    "loading_image": "FONDO CARGA/FONDO-CARGA.jpg",
    "spin_button": "BOTONES/Capa 12.png",
    "auto_on": "BOTONES/Capa 14.png",
    "info_button": "BOTONES/Capa 15.png",
    "bet_banner": "BOTONES/fondo_apuesta.png",
    "bet_minus": "BOTONES/boton_restar_apuesta.png",
    "bet_plus": "BOTONES/boton_sumar_apuesta.png",
    "balance_banner": "BANNER WIN/Rectángulo 2.png",
    "topbar_banner": "BANNER WIN/Rectángulo 2 copia 2.png",
    "thumbnail": "LOGO/LOGO.png",
    # Ícono de SONIDO (reutiliza el campo music_on/off genérico: el toggle
    # alterna mute igual aunque el casino no tenga pista de música subida).
    "music_on": "sonido.png",
    "music_off": "sonido.png",
    # Sustituye atrás+salir del header por este único ícono (ver PlayPage.tsx).
    "home_button": "home.png",
}


class Command(BaseCommand):
    help = "Crea/actualiza el casino Dulce Fiesta con su matemática y arte reales."

    def add_arguments(self, parser):
        parser.add_argument("--assets", default=DEFAULT_BASE, help="Ruta base del pack de assets.")

    @transaction.atomic
    def handle(self, *args, **opts):
        base = opts["assets"]
        game = self._build_math()
        self._assign_symbols(game, base)
        self._assign_chrome(game, base)
        self._add_bet_profile(game)
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDulce Fiesta listo: slug={game.slug} {game.grid_cols}x{game.grid_rows} "
                f"{game.win_mode} RTP objetivo={game.rtp_configurations.get(operator__isnull=True).target_rtp}"
            )
        )

    # ------------------------------------------------------------------ #
    def _build_math(self):
        """(Re)crea la matemática desde cero: borra el juego si ya existía (idempotente
        de verdad, no un update parcial) y lo reconstruye con create_configurable_game.
        Mismo orden que delete_game (sin --force): si ya tiene giros reales, para en
        vez de borrar auditoría — este comando es solo para (re)sembrar el demo."""
        existing = Game.objects.filter(slug=SLUG).first()
        if existing is not None:
            if existing.spins.exists():
                self.stderr.write(
                    f"  '{SLUG}' ya tiene giros registrados: no se borra su auditoría. "
                    f"Usa `manage.py delete_game {SLUG} --force` primero si quieres resembrarlo."
                )
            else:
                GameSession.objects.filter(game=existing).delete()
                RTPConfiguration.objects.filter(game=existing).delete()
                existing.delete()  # cascada: símbolos, pagos, bandas, líneas, apuestas, etc.

        spec = {
            "name": "Dulce Fiesta",
            "slug": SLUG,
            "title": "DULCE FIESTA",
            "grid_cols": 5,
            "grid_rows": 3,
            "win_mode": "WAYS",
            "volatility": "HIGH",
            "max_win_multiplier": 5000,
            "background_color": "#2a0a3d",
            "accent_color": "#ff4fa8",
            "background_type": "IMAGE",
            "symbols": [
                {"code": code, "name": name, "is_wild": wild, "is_scatter": scatter, "weight": weight}
                for code, name, wild, scatter, weight, _ in SYMBOLS
            ],
            "payouts": [
                {"code": code, "count": count, "multiplier": mult}
                for code, table in PAYOUTS.items()
                for count, mult in table.items()
            ],
            "target_rtp": 0.95,
            "bet_profiles": [
                {"currency": "USD", "min_bet": 20, "max_bet": 50000, "default_bet": 100,
                 "bet_levels": [20, 50, 100, 200, 500]},
            ],
            "free_spins": {
                "is_active": True, "trigger_scatter_count": 3, "spins_awarded": 10,
                "multiplier": 2, "retrigger": True,
            },
        }
        return create_configurable_game(spec=spec, math_version=MATH_VERSION)

    def _assign_symbols(self, game, base):
        for code, _name, _wild, _scatter, _weight, relpath in SYMBOLS:
            symbol = Symbol.objects.get(game=game, code=code)
            src = os.path.join(base, relpath)
            if not os.path.exists(src):
                self.stderr.write(f"  falta icono {src}")
                continue
            with open(src, "rb") as fh:
                symbol.image.save(os.path.basename(src), File(fh), save=True)
            self.stdout.write(f"  símbolo {code:11s} <- {relpath}")

    def _assign_chrome(self, game, base):
        touched = []
        for field, relpath in CHROME_FIELDS.items():
            src = os.path.join(base, relpath)
            if not os.path.exists(src):
                self.stderr.write(f"  falta chrome {src}")
                continue
            with open(src, "rb") as fh:
                getattr(game, field).save(os.path.basename(src), File(fh), save=False)
            touched.append(field)
            self.stdout.write(f"  chrome {field:18s} <- {relpath}")
        if touched:
            game.save(update_fields=touched)

    def _add_bet_profile(self, game):
        # Ya la crea create_configurable_game (USD); monedas extra, igual que el
        # resto del catálogo (seed_themed_casinos), para probar multimoneda.
        extra = [
            ("MXN", 400, 1_000_000, 2000, [400, 1000, 2000, 5000, 10000]),
            ("EUR", 20, 50_000, 100, [20, 50, 100, 200, 500]),
            ("COP", 2000, 5_000_000, 10000, [2000, 5000, 10000, 20000, 50000]),
        ]
        for currency, mn, mx, default, levels in extra:
            GameBetProfile.objects.update_or_create(
                game=game, currency=currency,
                defaults=dict(min_bet=mn, max_bet=mx, default_bet=default, bet_levels=levels, is_active=True),
            )
