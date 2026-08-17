"""
Borra un casino (juego) por slug.

Por defecto NO borra si tiene giros registrados (la auditoría es inmutable): eso es lo
correcto en producción. Con --force borra TODO lo asociado (transacciones, giros,
auditoría, sesiones, RTP y el juego). Úsalo SOLO para limpiar casinos de PRUEBA:
destruye registros de auditoría, algo que jamás debe hacerse con jugadas reales.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from app_audit.models import SpinAuditLog
from app_rtp.models import RTPConfiguration
from app_wallet_integration.models import WalletTransaction

from app_game.models import Game, GameSession, Spin


class Command(BaseCommand):
    help = "Borra un casino por slug. --force elimina también sus giros/auditoría (solo pruebas)."

    def add_arguments(self, parser):
        parser.add_argument("slug", help="Slug del casino a borrar.")
        parser.add_argument(
            "--force", action="store_true",
            help="Borra también giros, transacciones y auditoría (DESTRUCTIVO, solo pruebas).",
        )

    def handle(self, *args, **opts):
        slug = opts["slug"]
        try:
            game = Game.objects.get(slug=slug)
        except Game.DoesNotExist:
            raise CommandError(f"No existe un casino con slug '{slug}'.")

        spins = Spin.objects.filter(game=game).count()
        if spins and not opts["force"]:
            raise CommandError(
                f"El casino '{slug}' tiene {spins} giros registrados. Usa --force para "
                f"borrarlo IGUAL (elimina su auditoría; solo para casinos de prueba)."
            )

        with transaction.atomic():
            if opts["force"]:
                WalletTransaction.objects.filter(spin__game=game).delete()
                Spin.objects.filter(game=game).delete()
                SpinAuditLog.objects.filter(game_id=game.id).delete()
            GameSession.objects.filter(game=game).delete()
            RTPConfiguration.objects.filter(game=game).delete()
            game.delete()  # cascada: símbolos, pagos, bandas, líneas, apuestas, etc.

        self.stdout.write(self.style.SUCCESS(
            f"Casino '{slug}' borrado" + (f" (con {spins} giros y su auditoría)." if spins else ".")
        ))
