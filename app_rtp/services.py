"""
Servicios de RTP: SELECCIÓN de la configuración vigente (variante certificada).

Esto es lo legítimo: elegir qué configuración certificada aplica a un juego/operador
en un momento dado. NO ajusta probabilidades en caliente según el jugador.
"""
from django.db.models import Q
from django.utils import timezone

from .models import RTPConfiguration


class RTPConfigError(Exception):
    pass


def get_active_rtp_config(*, game, operator=None):
    """
    Devuelve la RTPConfiguration vigente para el juego y, si existe, el override
    del operador (prioritario sobre la configuración por defecto operator=None).
    """
    now = timezone.now()
    vigentes = RTPConfiguration.objects.filter(
        game=game, is_active=True, effective_from__lte=now,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=now))

    if operator is not None:
        cfg = vigentes.filter(operator=operator).order_by("-effective_from").first()
        if cfg is not None:
            return cfg

    cfg = vigentes.filter(operator__isnull=True).order_by("-effective_from").first()
    if cfg is None:
        raise RTPConfigError(
            f"No hay configuración de RTP vigente para el juego '{game.slug}'."
        )
    return cfg
