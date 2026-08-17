"""
Resolución de moneda por país. Prioridad:

  1) Query param explícito del consumidor:  ?currency=MXN  o  ?country=MX
     (lo envía la plataforma que integra el iframe; es la fuente autoritativa).
  2) Geolocalización por IP (ip-api.com, sin clave, cacheada por IP).
  3) Moneda por defecto.

Así ambos sistemas (el operador y este) quedan sincronizados: el operador manda
el país/moneda y la IP solo es respaldo.
"""
import ipaddress
import json
import urllib.request

# País (ISO-3166 alpha-2) -> moneda (ISO-4217). Ampliable.
COUNTRY_CURRENCY = {
    "MX": "MXN", "CL": "CLP", "VE": "USD", "CO": "COP", "AR": "ARS",
    "PE": "PEN", "BR": "BRL", "US": "USD", "EC": "USD", "PA": "USD",
    "BO": "BOB", "UY": "UYU", "PY": "PYG", "GT": "GTQ", "CR": "CRC",
    "DO": "DOP", "HN": "HNL", "NI": "NIO", "SV": "USD",
    # Zona euro (principales)
    "ES": "EUR", "PT": "EUR", "FR": "EUR", "DE": "EUR", "IT": "EUR",
    "IE": "EUR", "NL": "EUR", "BE": "EUR", "AT": "EUR",
    "GB": "GBP", "CA": "CAD",
}

# Cache simple en memoria de IP -> país (evita repetir la llamada externa).
_IP_CACHE: dict[str, str | None] = {}
_TIMEOUT = 2.0


def client_ip(request) -> str | None:
    """IP real del cliente (respeta X-Forwarded-For del proxy/CDN)."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved)


def country_from_ip(ip: str | None) -> str | None:
    """Devuelve el código de país (alpha-2) para una IP pública, o None."""
    if not ip or not _is_public(ip):
        return None
    if ip in _IP_CACHE:
        return _IP_CACHE[ip]
    country = None
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,countryCode"
        with urllib.request.urlopen(url, timeout=_TIMEOUT) as resp:  # noqa: S310 (URL fija de confianza)
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") == "success":
            country = data.get("countryCode")
    except Exception:
        country = None  # cualquier fallo -> se usa el fallback
    _IP_CACHE[ip] = country
    return country


def resolve_currency(request, available: set[str], default: str = "USD") -> tuple[str, str]:
    """
    Resuelve la moneda a mostrar. `available` = monedas con perfil de apuesta
    activo en el juego (si está vacío, se acepta cualquiera). Devuelve
    (moneda, origen) con origen en {"param", "ip", "default"}.
    """
    def ok(cur: str | None) -> bool:
        return bool(cur) and (not available or cur in available)

    # 1) Query param explícito (moneda o país).
    q_cur = (request.query_params.get("currency") or "").upper()[:10]
    if ok(q_cur):
        return q_cur, "param"
    q_country = (request.query_params.get("country") or "").upper()[:2]
    if q_country:
        cur = COUNTRY_CURRENCY.get(q_country)
        if ok(cur):
            return cur, "param"

    # 2) Geolocalización por IP.
    cur = COUNTRY_CURRENCY.get(country_from_ip(client_ip(request)) or "")
    if ok(cur):
        return cur, "ip"

    # 3) Por defecto (prefiere una disponible).
    if available and default not in available:
        default = sorted(available)[0]
    return default, "default"
