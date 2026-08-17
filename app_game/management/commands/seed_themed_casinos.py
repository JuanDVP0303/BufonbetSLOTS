"""
Crea casinos de demostración con arte real (reskin sobre la matemática certificada
de las plantillas demo). Copia los assets del pack de BuffonBet a los ImageField
del juego y de cada símbolo. Idempotente: re-ejecuta y re-asigna los assets.

Uso:
    python manage.py seed_themed_casinos
    python manage.py seed_themed_casinos --assets /ruta/al/pack   (opcional)

Requiere que existan las plantillas demo (python manage.py seed_demo_game).
"""
import os

from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction

from app_game.models import Game, GameBetProfile, Symbol
from app_game.services import create_game_from_template

# Perfiles de apuesta extra por moneda (además del USD que trae la plantilla), para
# demostrar el multimoneda. min/max/default/levels en unidades menores de cada moneda.
EXTRA_BET_PROFILES = [
    ("MXN", 400, 1_000_000, 2000, [400, 1000, 2000, 5000, 10000]),
    ("EUR", 20, 50_000, 100, [20, 50, 100, 200, 500]),
    ("CLP", 500, 2_000_000, 2000, [500, 1000, 2000, 5000, 10000]),
    ("COP", 2000, 5_000_000, 10000, [2000, 5000, 10000, 20000, 50000]),
]

# Rutas por defecto del pack de assets (ajustables con --assets).
DEFAULT_BASE = "/home/juand03/Projects/BuffonBet/media"


def sym(name):
    return ("symbols", name)


def chrome(name):
    return ("casino_assets", name)


# Cada casino: plantilla + tema + mapeo de los 6 símbolos (WILD, A, K, Q, J, T)
# + chrome (logo, banner de premio, botón de girar, música). Los símbolos se
# escogen del pack para que cada casino tenga identidad propia.
CASINOS = [
    {
        "slug": "a-todo-gas",
        "name": "A Todo Gas",
        "title": "A TODO GAS",
        "template": "demo-ways-5x3",
        "background_color": "#180a2e",
        "symbols": {
            "WILD": sym("20.png"),   # rayo
            "A": sym("22.png"),      # carro amarillo
            "K": sym("31.png"),      # trofeo alado
            "Q": sym("24.png"),      # disco de freno
            "J": sym("26.png"),      # palanca de cambios
            "T": sym("29.png"),      # bandera de meta
        },
        "thumbnail": chrome("LOGO_A_TODO_GAS_CUADRADO.png"),
        "logo": chrome("LOGO_A_TODO_GAS_CUADRADO.png"),
        "prize_banner": chrome("TROFEO.gif"),
        "spin_button": chrome("Grupo_1_copia_3.png"),
        "music_on": chrome("Grupo_1.png"),
        "music_off": chrome("Grupo_1_copia_2.png"),
        "music_track": chrome("File_E_0-46_331Music_-_Drive_short_4_mp3cut.net.mp3"),
    },
    {
        "slug": "567-bola",
        "name": "567 Bola",
        "title": "567 BOLA",
        "template": "demo-lines-3x3",
        "background_color": "#2a0a0a",
        "symbols": {
            "WILD": sym("1741446227415-removebg-preview.png"),  # trébol
            "A": sym("1741446257929-removebg-preview.png"),     # 7 dorado
            "K": sym("1741446275215-removebg-preview.png"),     # BAR
            "Q": sym("1740925788395-removebg-preview.png"),     # cereza
            "J": sym("1740925675673-removebg-preview.png"),     # uvas
            "T": sym("1740925710749-removebg-preview.png"),     # sandía
        },
        "thumbnail": chrome("LOGO.png"),
        "logo": chrome("LOGO.png"),
        "prize_banner": chrome("63.png"),
        "spin_button": chrome("73.png"),
        "music_on": chrome("71.png"),
        "music_off": chrome("72.png"),
        "music_track": chrome("playful-casino-slot-machine-bonus-2-183919.mp3"),
    },
    {
        "slug": "cosmic-emoji",
        "name": "Cosmic Emoji",
        "title": "COSMIC EMOJI",
        "template": "demo-lines-3x3",
        "background_color": "#05030f",
        "symbols": {
            "WILD": sym("61.png"),   # ojos de estrella
            "A": sym("60.png"),      # ojos de corazón
            "K": sym("64.png"),      # diablillo
            "Q": sym("62.png"),      # risa
            "J": sym("59.png"),      # gafas de sol
            "T": sym("69.png"),      # guiño lengua
        },
        "thumbnail": sym("61.png"),  # emoji ojos de estrella
        "background_image": chrome("Gemini_Generated_Image_s2ubgxs2ubgxs2ub.png"),
        "prize_banner": chrome("slot_olympus_7.png"),
        "spin_button": chrome("BOTTON_PLAY.png"),
        "music_on": chrome("Grupo_1.png"),
        "music_off": chrome("Grupo_1_copia_2.png"),
        "music_track": chrome("sonido_de_fondo_online-audio-converter.com.mp3"),
    },
    {
        "slug": "olympus-cards",
        "name": "Olympus Cards",
        "title": "OLYMPUS",
        "template": "demo-ways-5x3",
        "background_color": "#0a1030",
        "symbols": {
            "WILD": sym("1741446130643-removebg-preview.png"),  # corona
            "A": sym("1741446148345-removebg-preview.png"),     # gema
            "K": sym("1741446163662-removebg-preview.png"),     # corazón
            "Q": sym("1741446180380-removebg-preview.png"),     # pica
            "J": sym("1741446198556-removebg-preview.png"),     # diamante
            "T": sym("1741446214954-removebg-preview.png"),     # trébol (carta)
        },
        "thumbnail": sym("1741446130643-removebg-preview.png"),  # corona
        "background_image": chrome("Gemini_Generated_Image_s2ubgxs2ubgxs2ub.png"),
        "prize_banner": chrome("slot_olympus_7.png"),
        "spin_button": chrome("BOTTON_PLAY.png"),
        "music_on": chrome("71.png"),
        "music_off": chrome("72.png"),
        "music_track": chrome("playful-casino-slot-machine-bonus-2-183919.mp3"),
    },
]

GAME_ASSET_FIELDS = [
    "thumbnail", "background_image", "logo", "prize_banner", "spin_button",
    "music_on", "music_off", "music_track",
]


class Command(BaseCommand):
    help = "Crea casinos demo con arte real reskineando las plantillas demo."

    def add_arguments(self, parser):
        parser.add_argument("--assets", default=DEFAULT_BASE, help="Ruta base del pack de assets.")

    @transaction.atomic
    def handle(self, *args, **opts):
        base = opts["assets"]

        def path_of(spec):
            sub, name = spec
            return os.path.join(base, sub, name)

        for cfg in CASINOS:
            game = self._ensure_game(cfg)
            self._assign_symbols(game, cfg, path_of)
            self._assign_chrome(game, cfg, path_of)
            self._add_currencies(game)
            self.stdout.write(self.style.SUCCESS(f"  ✓ {cfg['slug']:14s} ({game.win_mode} {game.grid_cols}x{game.grid_rows})"))

        self.stdout.write(self.style.SUCCESS(f"\n{len(CASINOS)} casinos temáticos listos en el lobby."))

    # ------------------------------------------------------------------ #
    def _ensure_game(self, cfg):
        game = Game.objects.filter(slug=cfg["slug"]).first()
        if game is None:
            game = create_game_from_template(
                template_slug=cfg["template"], name=cfg["name"], slug=cfg["slug"],
                title=cfg["title"], background_color=cfg["background_color"],
            )
        else:
            game.title = cfg["title"]
            game.background_color = cfg["background_color"]
            game.save(update_fields=["title", "background_color"])
        return game

    def _add_currencies(self, game):
        for currency, mn, mx, default, levels in EXTRA_BET_PROFILES:
            GameBetProfile.objects.update_or_create(
                game=game, currency=currency,
                defaults=dict(min_bet=mn, max_bet=mx, default_bet=default, bet_levels=levels, is_active=True),
            )

    def _assign_symbols(self, game, cfg, path_of):
        for code, spec in cfg["symbols"].items():
            symbol = Symbol.objects.filter(game=game, code=code).first()
            if symbol is None:
                self.stderr.write(f"    símbolo {code} no existe en {game.slug}")
                continue
            src = path_of(spec)
            if not os.path.exists(src):
                self.stderr.write(f"    falta asset {src}")
                continue
            with open(src, "rb") as fh:
                symbol.image.save(os.path.basename(src), File(fh), save=True)

    def _assign_chrome(self, game, cfg, path_of):
        touched = []
        for field in GAME_ASSET_FIELDS:
            if field not in cfg:
                continue
            src = path_of(cfg[field])
            if not os.path.exists(src):
                self.stderr.write(f"    falta chrome {src}")
                continue
            with open(src, "rb") as fh:
                getattr(game, field).save(os.path.basename(src), File(fh), save=False)
            touched.append(field)
        if touched:
            game.save(update_fields=touched)
