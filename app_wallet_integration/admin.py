from django.contrib import admin

from .models import FxRate, LaunchToken, Operator, PlayerSession, WalletTransaction


@admin.register(Operator)
class OperatorAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "wallet_mode", "wallet_base_url", "is_active")
    list_filter = ("is_active", "wallet_mode")
    fields = ("name", "code", "is_active", "wallet_mode", "wallet_base_url",
              "webhook_hmac_secret_ref", "jwt_verifying_key_ref", "allowed_iframe_origins")


admin.site.register(LaunchToken)
admin.site.register(PlayerSession)
admin.site.register(FxRate)


@admin.register(WalletTransaction)
class WalletTransactionAdmin(admin.ModelAdmin):
    list_display = ("id", "operator", "type", "amount", "currency", "status", "created_at")
    list_filter = ("type", "status", "operator")
    search_fields = ("idempotency_key", "external_reference")
    readonly_fields = [f.name for f in WalletTransaction._meta.fields]
