"""
Cuentas internas, roles y monedero interno.

MODO ACTUAL (demo / pre-API): esta plataforma gestiona jugadores y su saldo
internamente. El Master acredita saldo a mano. Cuando se integre el proveedor
real vía API, el saldo real lo enviará la plataforma del operador y este monedero
interno pasará a ser el "modo demo/fun-money".

Roles: PLAYER (se auto-registra, saldo 0) y MASTER (lo hace todo).
El saldo se guarda en unidades menores (céntimos), nunca float.
"""
from django.conf import settings
from django.db import models

from common.models import BaseModel


class Role(models.TextChoices):
    PLAYER = "PLAYER", "Jugador"
    MASTER = "MASTER", "Master"
    OPERATOR = "OPERATOR", "Operador"


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.PLAYER)
    # Solo para role=OPERATOR: a qué operador pertenece esta cuenta. Su back office
    # muestra EXCLUSIVAMENTE los datos de este operador (aislamiento).
    operator = models.ForeignKey(
        "app_wallet_integration.Operator",
        null=True, blank=True, on_delete=models.CASCADE, related_name="user_accounts",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "account_profile"

    def __str__(self):
        return f"{self.user.email or self.user.username} ({self.role})"


class PlayerWallet(models.Model):
    """Monedero interno de un jugador. El saldo es la fuente de verdad del demo."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wallet"
    )
    balance = models.BigIntegerField(default=0, help_text="Saldo en unidades menores (céntimos).")
    currency = models.CharField(max_length=10, default="USD")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "account_wallet"

    def __str__(self):
        return f"{self.user.email or self.user.username}: {self.balance} {self.currency}"


class BalanceEntryKind(models.TextChoices):
    MASTER_CREDIT = "MASTER_CREDIT", "Crédito del master"
    BET = "BET", "Apuesta"
    WIN = "WIN", "Premio"
    ADJUSTMENT = "ADJUSTMENT", "Ajuste"


class BalanceEntry(BaseModel):
    """
    Libro de movimientos del monedero (append-only en la práctica). Cada línea
    guarda la variación con signo y el saldo resultante, para trazabilidad total.
    """

    wallet = models.ForeignKey(PlayerWallet, on_delete=models.PROTECT, related_name="entries")
    kind = models.CharField(max_length=16, choices=BalanceEntryKind.choices)
    delta = models.BigIntegerField(help_text="Variación con signo, en céntimos (+ acredita, - debita).")
    balance_after = models.BigIntegerField(help_text="Saldo resultante tras aplicar el movimiento.")
    reference = models.CharField(max_length=140, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "account_balance_entry"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["wallet", "kind"])]

    def __str__(self):
        return f"{self.kind} {self.delta:+d} -> {self.balance_after}"
