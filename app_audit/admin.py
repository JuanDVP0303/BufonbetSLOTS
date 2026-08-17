from django.contrib import admin

from .models import SpinAuditLog


@admin.register(SpinAuditLog)
class SpinAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "sequence_number",
        "spin_id",
        "external_player_id",
        "bet_amount",
        "win_amount",
        "rtp_applied",
        "recorded_at",
    )
    list_filter = ("currency", "math_version")
    search_fields = ("spin_id", "external_player_id")
    # Registro de solo lectura desde el admin (además de la inmutabilidad del modelo).
    readonly_fields = [f.name for f in SpinAuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
