"""
Registro de auditoría INMUTABLE y a prueba de manipulación (append-only).

Cada spin genera un registro que NO puede modificarse ni borrarse desde la aplicación.
Los registros se encadenan por hash (prev_hash -> record_hash) para que cualquier
alteración posterior sea detectable (estilo blockchain, sin la parte distribuida).

La protección a nivel de aplicación (abajo) es una PRIMERA línea. En producción,
refuérzalo de verdad con:
  - Un rol de BD sin permisos UPDATE/DELETE sobre esta tabla.
  - Triggers de PostgreSQL que rechacen UPDATE/DELETE.
  - Exportación periódica a almacenamiento WORM (p.ej. S3 Object Lock) y/o
    anclaje del último hash en un sistema externo.
"""
import hashlib
import json

from django.db import models
from django.utils import timezone


class AuditImmutableError(Exception):
    """Se lanza al intentar modificar o borrar un registro de auditoría."""


class SpinAuditLog(models.Model):
    # PK autoincremental (secuencia) para un orden estricto en la cadena de hashes.
    sequence_number = models.BigAutoField(primary_key=True)

    spin_id = models.UUIDField(db_index=True, unique=True)
    operator_id = models.UUIDField(db_index=True, null=True, blank=True, help_text="Operador externo; nulo en modo plataforma propia.")
    player_user_id = models.IntegerField(db_index=True, null=True, blank=True, help_text="Jugador interno; nulo en modo proveedor.")
    external_player_id = models.CharField(max_length=120, db_index=True, help_text="user_id del casino, o email/id del jugador interno.")
    game_id = models.UUIDField(db_index=True)

    bet_amount = models.BigIntegerField(help_text="En céntimos.")
    win_amount = models.BigIntegerField(help_text="En céntimos.")
    currency = models.CharField(max_length=3)

    matrix_result = models.JSONField()
    winning_lines = models.JSONField(default=list)

    rtp_applied = models.DecimalField(max_digits=6, decimal_places=4)
    rtp_config_id = models.UUIDField()
    math_version = models.CharField(max_length=40)

    rng_algorithm = models.CharField(max_length=40)
    rng_seed = models.CharField(max_length=128, blank=True)

    # Cadena de integridad
    prev_hash = models.CharField(max_length=64, blank=True)
    record_hash = models.CharField(max_length=64, blank=True)

    recorded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "audit_spin_log"
        ordering = ["sequence_number"]

    def compute_record_hash(self):
        """Hash SHA-256 canónico del contenido + prev_hash (encadenamiento)."""
        payload = {
            "spin_id": str(self.spin_id),
            "operator_id": str(self.operator_id),
            "player_user_id": self.player_user_id,
            "external_player_id": self.external_player_id,
            "game_id": str(self.game_id),
            "bet_amount": self.bet_amount,
            "win_amount": self.win_amount,
            "currency": self.currency,
            "matrix_result": self.matrix_result,
            "winning_lines": self.winning_lines,
            "rtp_applied": str(self.rtp_applied),
            "rtp_config_id": str(self.rtp_config_id),
            "math_version": self.math_version,
            "rng_algorithm": self.rng_algorithm,
            "rng_seed": self.rng_seed,
            "recorded_at": self.recorded_at.isoformat(),
            "prev_hash": self.prev_hash,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def save(self, *args, **kwargs):
        # Solo se permite la inserción inicial; cualquier reescritura se rechaza.
        if self.pk is not None and SpinAuditLog.objects.filter(pk=self.pk).exists():
            raise AuditImmutableError(
                "Los registros de auditoría son inmutables y no pueden modificarse."
            )
        # Encadena con el último registro existente.
        # NOTA de concurrencia: para alta concurrencia, serializa la escritura de la
        # cadena (p.ej. una cola/worker único, o SELECT ... FOR UPDATE sobre un
        # registro "cabeza") para evitar carreras en prev_hash.
        last = SpinAuditLog.objects.order_by("-sequence_number").first()
        self.prev_hash = last.record_hash if last else ""
        self.record_hash = self.compute_record_hash()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AuditImmutableError("Los registros de auditoría no pueden eliminarse.")

    def __str__(self):
        return f"#{self.sequence_number} spin={self.spin_id}"
