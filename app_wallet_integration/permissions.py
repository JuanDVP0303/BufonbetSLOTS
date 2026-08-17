"""
Autorización de operadores por API key (server-a-servidor).

Uso en una vista:
    permission_classes = [HasOperatorApiKey]
    ...
    operator = request.operator  # queda disponible tras pasar el permiso

Cabecera esperada:
    Authorization: Api-Key <prefix>.<secret>
"""
from rest_framework.permissions import BasePermission

from .services import resolve_operator_from_key
from .tokens import read_session_token

_SCHEME = "api-key"


def _extract_key(request):
    auth = request.META.get("HTTP_AUTHORIZATION", "")
    parts = auth.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == _SCHEME:
        return parts[1].strip()
    # Alternativa por cabecera dedicada (útil si el operador ya usa Authorization
    # para otra cosa en su gateway).
    return request.META.get("HTTP_X_OPERATOR_KEY", "").strip() or None


class HasOperatorApiKey(BasePermission):
    """Deja pasar solo si la API key es válida; adjunta el operador a request.operator."""

    message = "API key de operador ausente o inválida."

    def has_permission(self, request, view):
        raw = _extract_key(request)
        if not raw:
            return False
        operator = resolve_operator_from_key(raw)
        if operator is None:
            return False
        request.operator = operator
        return True


class HasSessionToken(BasePermission):
    """
    Autoriza al IFRAME por su session token (Authorization: Bearer <token>). Resuelve
    y adjunta la GameSession abierta a request.game_session. No expone la API key.
    """

    message = "Session token ausente, inválido o expirado."

    def has_permission(self, request, view):
        from app_game.models import GameSession  # import perezoso: evita ciclo de apps

        auth = request.META.get("HTTP_AUTHORIZATION", "")
        parts = auth.split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return False
        gs_id = read_session_token(parts[1].strip())
        if not gs_id:
            return False
        session = GameSession.objects.filter(id=gs_id, is_open=True).first()
        if session is None:
            return False
        request.game_session = session
        return True
