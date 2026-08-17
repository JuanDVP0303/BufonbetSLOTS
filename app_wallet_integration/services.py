"""
Servicios de operador: emisión y verificación de API keys server-a-servidor.

La API key autentica al BACKEND del operador cuando llama a la API del proveedor
(p. ej. para lanzar sesiones de juego). NO autentica al jugador: eso lo hace la
PlayerSession creada en el launch.

Formato de la clave: "<prefix>.<secret>".
  - prefix: parte visible (no secreta) para localizar la fila sin exponer el secreto.
  - secret: parte aleatoria larga; solo se ve UNA vez, al crearla.
Se guarda únicamente el SHA-256 de la clave completa. Nunca el valor en claro.
"""
import hashlib
import hmac
import secrets

from django.utils import timezone

from .models import OperatorApiKey


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_api_key(operator, label: str = "") -> tuple[str, OperatorApiKey]:
    """
    Crea una API key para el operador y devuelve (clave_en_claro, registro).
    La clave en claro NO se persiste: muéstrala una sola vez a quien la crea.
    """
    prefix = secrets.token_hex(6)  # 12 chars visibles
    secret = secrets.token_urlsafe(32)
    raw = f"{prefix}.{secret}"
    api_key = OperatorApiKey.objects.create(
        operator=operator,
        label=label,
        prefix=prefix,
        hashed_key=_hash_key(raw),
    )
    return raw, api_key


def resolve_operator_from_key(raw: str):
    """
    Verifica una clave en claro y devuelve su Operator, o None si es inválida
    (formato, prefijo inexistente, clave/operador inactivos o hash no coincide).
    Comparación en tiempo constante para no filtrar información por timing.
    """
    if not raw or "." not in raw:
        return None
    prefix = raw.split(".", 1)[0]
    candidate = _hash_key(raw)
    # Puede haber varias claves por prefijo (colisión improbable): compáralas todas.
    for api_key in OperatorApiKey.objects.filter(prefix=prefix, is_active=True).select_related("operator"):
        if hmac.compare_digest(api_key.hashed_key, candidate):
            if not api_key.operator.is_active:
                return None
            OperatorApiKey.objects.filter(pk=api_key.pk).update(last_used_at=timezone.now())
            return api_key.operator
    return None
