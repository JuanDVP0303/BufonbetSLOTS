"""
Configuración de RTP (Return to Player) y margen de la casa.

LÍMITE DE CUMPLIMIENTO (léelo bien):
El RTP debe corresponder a un modelo matemático CERTIFICADO. El "RTP dinámico"
LEGÍTIMO consiste en SELECCIONAR entre variantes certificadas del juego
(p.ej. 96%, 94%, 92%) por juego/operador, y en aplicarlas de forma transparente
y consistente para todos los jugadores de esa configuración.

Lo que NO es legal (y la certificación del RNG existe para impedirlo): alterar en
secreto el resultado de un jugador concreto en función de su saldo/historial para
forzar que pierda. Eso es fraude y te cierra cualquier mercado regulado. Diseña el
sistema para NO poder hacerlo: el motor no debe conocer la identidad del jugador
al calcular el resultado, solo la configuración matemática vigente.
"""
from django.conf import settings
from django.db import models

from common.models import BaseModel


class RTPConfiguration(BaseModel):
    game = models.ForeignKey(
        "app_game.Game", related_name="rtp_configurations", on_delete=models.PROTECT
    )
    operator = models.ForeignKey(
        "app_wallet_integration.Operator",
        related_name="rtp_configurations",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        help_text="Nulo = configuración por defecto del juego (sin override de operador).",
    )
    name = models.CharField(max_length=80)

    target_rtp = models.DecimalField(
        max_digits=6, decimal_places=4, help_text="Fracción. Ej: 0.9600 = 96%."
    )
    house_margin = models.DecimalField(
        max_digits=6, decimal_places=4, help_text="1 - target_rtp. Ej: 0.0400 = 4%."
    )
    math_version = models.CharField(
        max_length=40, help_text="Debe coincidir con ReelStrip.math_version certificado."
    )
    certification_reference = models.CharField(
        max_length=120, blank=True, help_text="Nº de informe del laboratorio (GLI/iTech/BMM)."
    )

    is_active = models.BooleanField(default=True)
    effective_from = models.DateTimeField(help_text="Inicio de vigencia.")
    effective_to = models.DateTimeField(null=True, blank=True, help_text="Fin de vigencia (nulo = indefinido).")

    class Meta:
        db_table = "rtp_configuration"
        indexes = [models.Index(fields=["game", "operator", "is_active"])]

    def __str__(self):
        return f"{self.game_id} · {self.name} · rtp={self.target_rtp}"


class RTPChangeAudit(BaseModel):
    """
    Traza de cambios en la configuración de RTP. Requisito de cumplimiento:
    quién cambió qué, cuándo y por qué. No sustituye al log inmutable de spins.
    """

    rtp_configuration = models.ForeignKey(
        RTPConfiguration, related_name="changes", on_delete=models.PROTECT
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    old_value = models.JSONField()
    new_value = models.JSONField()
    reason = models.TextField()

    class Meta:
        db_table = "rtp_change_audit"
        ordering = ["-created_at"]

    def __str__(self):
        return f"cambio RTP {self.rtp_configuration_id} @ {self.created_at:%Y-%m-%d %H:%M}"
