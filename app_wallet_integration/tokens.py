"""
Session token para el iframe (modo proveedor).

El backend del operador llama a /provider/launch/ con su API KEY (server-to-server) y
recibe un SESSION TOKEN corto, firmado y ligado a una GameSession concreta. El iframe
(navegador) usa ESE token para pedir estado y tirar — NUNCA la API key del operador,
que es un secreto que no debe salir del servidor del operador.

Es un JWT firmado con SECRET_KEY (stateless: cualquier instancia lo verifica sin BD).
La sesión sigue pudiendo invalidarse cerrando la GameSession (is_open=False).
"""
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone

_ALG = "HS256"


def _lifetime() -> timedelta:
    return getattr(settings, "EMBED_SESSION_TOKEN_LIFETIME", timedelta(hours=8))


def make_session_token(game_session) -> str:
    now = timezone.now()
    op_id = game_session.player_session.operator_id if game_session.player_session else None
    payload = {
        "gs": str(game_session.id),
        "op": str(op_id) if op_id is not None else None,
        "iat": int(now.timestamp()),
        "exp": int((now + _lifetime()).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=_ALG)


def read_session_token(raw: str):
    """Devuelve el id de GameSession si el token es válido y vigente, o None."""
    if not raw:
        return None
    try:
        payload = jwt.decode(raw, settings.SECRET_KEY, algorithms=[_ALG])
    except jwt.InvalidTokenError:
        return None
    return payload.get("gs")
