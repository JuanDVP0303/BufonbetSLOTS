"""
Reinicia los datos de PRUEBA de la plataforma: borra giros, sesiones, movimientos,
tiradas gratis y jugadores de prueba, CONSERVANDO lo que no es descartable:
casinos (juegos) y su configuración, operadores + API keys, cuentas admin (Master)
y de operador, monedas, tasas FX y la config de RTP.

Seguro por defecto:
  python manage.py reset_test_data                # DRY-RUN: muestra qué borraría, no borra
  python manage.py reset_test_data --yes          # ejecuta (CONSERVA el log de auditoría)
  python manage.py reset_test_data --yes --wipe-audit   # además vacía el log de auditoría

El borrado va en orden hijo -> padre para respetar los on_delete=PROTECT.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from app_accounts.models import BalanceEntry, PlayerWallet, Role
from app_audit.models import SpinAuditLog
from app_game.models import FreeRoundGrant, Game, GameSession, Spin
from app_wallet_integration.models import (
    LaunchToken,
    Operator,
    PlayerSession,
    WalletTransaction,
)


class Command(BaseCommand):
    help = (
        "Reinicia datos de prueba (giros/sesiones/jugadores), conservando casinos, "
        "operadores y cuentas admin/operador."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes", action="store_true",
            help="Ejecuta de verdad. Sin esto solo muestra qué se borraría (dry-run).",
        )
        parser.add_argument(
            "--wipe-audit", action="store_true",
            help="También vacía el log INMUTABLE de auditoría (arranca la cadena de cero).",
        )

    def handle(self, *args, **opts):
        User = get_user_model()
        run = opts["yes"]
        wipe_audit = opts["wipe_audit"]

        # Jugadores de PRUEBA: rol PLAYER y NUNCA admin (superuser/staff) ni cuenta de
        # operador (rol OPERATOR). Así se conservan admins y accesos de operador.
        test_players = User.objects.filter(
            profile__role=Role.PLAYER, is_superuser=False, is_staff=False
        )

        # Orden hijo -> padre (respeta on_delete=PROTECT).
        plan = [
            ("Movimientos de billetera (operador)", WalletTransaction.objects.all()),
            ("Giros (spins)", Spin.objects.all()),
            ("Sesiones de juego", GameSession.objects.all()),
            ("Sesiones de jugador (operador)", PlayerSession.objects.all()),
            ("Tokens de lanzamiento", LaunchToken.objects.all()),
            ("Tiradas gratis concedidas", FreeRoundGrant.objects.all()),
            ("Movimientos de saldo (interno)", BalanceEntry.objects.all()),
            ("Billeteras internas", PlayerWallet.objects.all()),
            ("Jugadores de prueba (usuarios)", test_players),
        ]
        if wipe_audit:
            plan.append(("Log de AUDITORÍA (inmutable)", SpinAuditLog.objects.all()))

        header = (
            "DRY-RUN — no se borra nada. Añade --yes para ejecutar."
            if not run else "Ejecutando reinicio de datos de prueba…"
        )
        self.stdout.write(self.style.MIGRATE_HEADING(header))

        # Cuenta ANTES de tocar nada (para el reporte).
        counts = [(label, qs.count()) for label, qs in plan]
        self.stdout.write("Se borrará:")
        for label, n in counts:
            self.stdout.write(f"  {n:>8}  {label}")

        # Lo que se CONSERVA (informativo).
        keep = (
            f"Conserva: {Game.objects.count()} casinos, {Operator.objects.count()} operadores, "
            f"{User.objects.filter(is_superuser=True).count()} admin(s), "
            f"{User.objects.filter(profile__role=Role.OPERATOR).count()} cuenta(s) de operador, "
            f"monedas/FX/RTP"
        )
        if not wipe_audit:
            keep += f", y {SpinAuditLog.objects.count()} filas de auditoría"
        self.stdout.write(self.style.SUCCESS(keep))

        if not run:
            self.stdout.write(self.style.WARNING("Dry-run: no se borró nada."))
            return

        with transaction.atomic():
            for _label, qs in plan:
                qs.delete()

        self.stdout.write(self.style.SUCCESS("✓ Listo. Datos de prueba reiniciados."))
        if not wipe_audit:
            self.stdout.write(
                "Nota: la auditoría se conservó. Para vaciarla también: --wipe-audit."
            )
