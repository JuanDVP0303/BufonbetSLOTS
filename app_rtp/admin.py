from django.contrib import admin

from .models import RTPChangeAudit, RTPConfiguration


@admin.register(RTPConfiguration)
class RTPConfigurationAdmin(admin.ModelAdmin):
    list_display = ("name", "game", "operator", "target_rtp", "math_version", "is_active")
    list_filter = ("is_active", "game", "operator")


@admin.register(RTPChangeAudit)
class RTPChangeAuditAdmin(admin.ModelAdmin):
    list_display = ("rtp_configuration", "changed_by", "created_at")
    readonly_fields = [f.name for f in RTPChangeAudit._meta.fields]
