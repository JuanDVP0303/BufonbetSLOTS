from rest_framework.permissions import BasePermission

from .models import Role


class IsMaster(BasePermission):
    """Permite solo a usuarios Master (o superusuarios de Django)."""

    message = "Requiere rol Master."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        profile = getattr(user, "profile", None)
        return bool(profile and profile.role == Role.MASTER)


class IsOperatorUser(BasePermission):
    """
    Cuenta de OPERADOR: usuario con rol OPERATOR ligado a un Operator. Adjunta
    request.operator para que su back office vea SOLO los datos de su operador.
    """

    message = "Requiere una cuenta de operador."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        profile = getattr(user, "profile", None)
        if not (profile and profile.role == Role.OPERATOR and profile.operator_id):
            return False
        request.operator = profile.operator
        return True
