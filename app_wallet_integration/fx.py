"""
Conversión de moneda para REPORTING (nunca para el juego).

Regla de oro (ver FxRate): el jugador apuesta y cobra en SU moneda; jamás se
convierte durante el juego. Estas funciones solo consolidan métricas (GGR) de
varias monedas en una base común (USD) para reportes.

Convención de tasa (igual que FxRate y que el `usd-{code}` de BuffonBet):
    base=USD, quote=CODE, rate = unidades locales por 1 USD.
    => USD = importe_local / rate.

Las tasas se leen del ÚLTIMO punto de FxRate (el snapshot más reciente que dejó
el servicio cargador). Si no hay tasa para una moneda, se devuelve None y el
reporte marca esa moneda como "sin tasa" en vez de inventar un número.
"""
from decimal import Decimal

from common.models import Currency

from .models import FxRate


def latest_usd_rate(code: str):
    """Tasa (Decimal) unidades locales por 1 USD, o None si no hay. USD => 1."""
    code = (code or "").upper()
    if code == "USD":
        return Decimal(1)
    fx = (
        FxRate.objects.filter(base_currency="USD", quote_currency=code)
        .order_by("-effective_at")
        .first()
    )
    return Decimal(fx.rate) if fx else None


def _exponent(code: str, cache: dict | None = None) -> int:
    if cache is not None and code in cache:
        return cache[code]
    cur = Currency.objects.filter(code=code).first()
    exp = cur.exponent if cur else 2
    if cache is not None:
        cache[code] = exp
    return exp


def to_usd(amount_minor: int, code: str, exponent: int | None = None):
    """
    Convierte un importe en UNIDADES MENORES de `code` a USD (Decimal, en unidades
    MAYORES/dólares). Devuelve None si no hay tasa para esa moneda.
    """
    rate = latest_usd_rate(code)
    if rate is None or rate == 0:
        return None
    if exponent is None:
        exponent = _exponent(code)
    major_local = Decimal(amount_minor) / (Decimal(10) ** exponent)
    return major_local / rate


def convert_currency_totals(rows):
    """
    Recibe filas [{currency, spins, bet, win, ggr}] (montos en unidades menores) y
    devuelve (usd_totals, missing) donde:
      - usd_totals: {"bet","win","ggr"} sumados en USD (Decimal, dólares), solo de
        las monedas con tasa disponible.
      - missing: lista de códigos de moneda sin tasa (no se pudieron convertir).
    """
    exp_cache: dict = {}
    usd = {"bet": Decimal(0), "win": Decimal(0), "ggr": Decimal(0)}
    missing = []
    for r in rows:
        code = r["currency"]
        rate = latest_usd_rate(code)
        if rate is None or rate == 0:
            missing.append(code)
            continue
        exp = _exponent(code, exp_cache)
        factor = (Decimal(10) ** exp) * rate
        usd["bet"] += Decimal(r["bet"]) / factor
        usd["win"] += Decimal(r["win"]) / factor
        usd["ggr"] += Decimal(r["ggr"]) / factor
    return usd, missing
