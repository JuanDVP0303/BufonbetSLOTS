"""
Modelos abstractos compartidos.

Convención de dinero:
- TODO monto se almacena en UNIDADES MENORES (céntimos) como entero (BigIntegerField).
- NUNCA se usan float para dinero. Evita errores de redondeo y facilita la conciliación.
- La moneda se guarda como código ISO-4217 de 3 letras junto al monto.
"""
import uuid
from decimal import Decimal

from django.db import models


class UUIDModel(models.Model):
    """PK UUID: no expone conteos ni es enumerable desde el exterior."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimeStampedModel):
    class Meta:
        abstract = True


class Currency(models.Model):
    """
    Catálogo de monedas soportadas (datos de referencia). Multi-moneda base.

    TRAMPA que cierra este modelo: NO todas las monedas tienen 2 decimales.
      - USD, EUR      = 2
      - JPY, KRW      = 0
      - BHD, KWD, TND = 3
      - Cripto (BTC)  = 8
    El entero almacenado equivale a: valor_real * 10**exponent.
    Sin este exponente, ¥1000 se interpretaría erróneamente como ¥10,00.
    """

    code = models.CharField(
        max_length=10, primary_key=True, help_text="ISO-4217 (USD, EUR, JPY) o símbolo cripto."
    )
    name = models.CharField(max_length=60)
    exponent = models.PositiveSmallIntegerField(
        default=2, help_text="Nº de decimales (dígitos menores). USD=2, JPY=0, BHD=3, BTC=8."
    )
    symbol = models.CharField(max_length=8, blank=True)
    is_crypto = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    # pid (instrument id) del par USD/<code> en investing.com/forexpros. Lo usa el
    # servicio load_fx_rates para suscribirse por websocket. Vacío = no se cotiza en
    # vivo (esa moneda saldrá "sin tasa" en los reportes hasta que se complete el pid).
    investing_pid = models.CharField(
        max_length=20, blank=True, default="", help_text="pid de investing.com para el par USD/<code>."
    )

    class Meta:
        db_table = "currency"
        ordering = ["code"]
        verbose_name_plural = "currencies"

    def to_minor(self, major_amount) -> int:
        """Unidad mayor (Decimal '10.50') -> entero menor (1050 si exponent=2)."""
        factor = Decimal(10) ** self.exponent
        return int((Decimal(str(major_amount)) * factor).to_integral_value())

    def to_major(self, minor_amount: int) -> Decimal:
        """Entero menor (1050) -> unidad mayor (Decimal '10.50')."""
        return Decimal(minor_amount) / (Decimal(10) ** self.exponent)

    def __str__(self):
        return self.code
