"""Servicios del monedero interno con integridad transaccional."""
from django.db import transaction

from .models import BalanceEntry, PlayerWallet


class InsufficientFunds(Exception):
    pass


@transaction.atomic
def apply_balance(*, wallet_id, delta: int, kind: str, reference: str = "", created_by=None) -> BalanceEntry:
    """
    Aplica una variación de saldo (con signo) de forma atómica y registra el
    movimiento. Usa SELECT ... FOR UPDATE para evitar carreras. Rechaza saldos
    negativos (no se puede debitar más de lo que hay).
    """
    wallet = PlayerWallet.objects.select_for_update().get(pk=wallet_id)
    new_balance = wallet.balance + delta
    if new_balance < 0:
        raise InsufficientFunds(f"Saldo insuficiente: {wallet.balance} + ({delta}).")
    wallet.balance = new_balance
    wallet.save(update_fields=["balance", "updated_at"])
    return BalanceEntry.objects.create(
        wallet=wallet,
        kind=kind,
        delta=delta,
        balance_after=new_balance,
        reference=reference,
        created_by=created_by,
    )
