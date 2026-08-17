"""
Verificación de RTP por Monte Carlo (offline / QA / certificación).

Corre N tiros a través del motor real y reporta el RTP EMPÍRICO de la
configuración certificada del juego. Es la forma correcta de comprobar que las
bandas dan el target; NO es un mecanismo de ajuste en producción.

Uso:
    python manage.py simulate_rtp <slug> --spins 5000000 --bet 100
"""
from django.core.management.base import BaseCommand, CommandError

from app_game.engine import simulate_rtp
from app_game.models import Game
from app_game.services import build_engine
from app_rtp.services import RTPConfigError, get_active_rtp_config


class Command(BaseCommand):
    help = "Verifica el RTP empírico de un juego mediante simulación Monte Carlo."

    def add_arguments(self, parser):
        parser.add_argument("slug", help="Slug del juego.")
        parser.add_argument("--spins", type=int, default=1_000_000)
        parser.add_argument("--bet", type=int, default=100, help="Apuesta total en céntimos.")
        parser.add_argument("--math-version", default=None, help="Por defecto: la del RTP vigente.")

    def handle(self, *args, **opts):
        try:
            game = Game.objects.get(slug=opts["slug"])
        except Game.DoesNotExist:
            raise CommandError(f"Juego '{opts['slug']}' no encontrado.")

        math_version = opts["math_version"]
        if math_version is None:
            try:
                math_version = get_active_rtp_config(game=game).math_version
            except RTPConfigError as exc:
                raise CommandError(str(exc))

        engine = build_engine(game, math_version)
        res = simulate_rtp(engine, opts["bet"], opts["spins"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Juego '{game.slug}' math_version={math_version}\n"
                f"  RTP total   = {res['rtp']:.4%}\n"
                f"  RTP base    = {res['rtp_base']:.4%}\n"
                f"  RTP jackpot = {res['rtp_jackpot']:.4%}\n"
                f"  hit rate    = {res['hit_rate']:.4%}\n"
                f"  tiros       = {res['spins']:,}"
            )
        )
