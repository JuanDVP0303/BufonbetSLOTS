from django.contrib import admin

from .models import BalanceEntry, PlayerWallet, Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "created_at")
    list_filter = ("role",)


@admin.register(PlayerWallet)
class PlayerWalletAdmin(admin.ModelAdmin):
    list_display = ("user", "balance", "currency", "updated_at")


@admin.register(BalanceEntry)
class BalanceEntryAdmin(admin.ModelAdmin):
    list_display = ("wallet", "kind", "delta", "balance_after", "created_by", "created_at")
    list_filter = ("kind",)
    readonly_fields = [f.name for f in BalanceEntry._meta.fields]
