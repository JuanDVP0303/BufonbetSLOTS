"""Siembra el catálogo de monedas soportadas (idempotente)."""
from django.core.management.base import BaseCommand

from common.models import Currency

# code, name, exponent, symbol
CURRENCIES = [
    ("USD", "US Dollar", 2, "$"),
    ("EUR", "Euro", 2, "€"),
    ("MXN", "Peso Mexicano", 2, "$"),
    ("CLP", "Peso Chileno", 0, "$"),
    ("COP", "Peso Colombiano", 2, "$"),
    ("ARS", "Peso Argentino", 2, "$"),
    ("PEN", "Sol Peruano", 2, "S/"),
    ("BRL", "Real Brasileño", 2, "R$"),
    ("GBP", "Libra Esterlina", 2, "£"),
    ("CAD", "Dólar Canadiense", 2, "$"),
]


class Command(BaseCommand):
    help = "Siembra las monedas soportadas."

    def handle(self, *args, **opts):
        for code, name, exp, symbol in CURRENCIES:
            Currency.objects.update_or_create(
                code=code, defaults=dict(name=name, exponent=exp, symbol=symbol, is_active=True)
            )
        self.stdout.write(self.style.SUCCESS(f"{len(CURRENCIES)} monedas listas."))
