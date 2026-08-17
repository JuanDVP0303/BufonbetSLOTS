from django.contrib import admin

from .models import (
    DropJackpot,
    Game,
    GameBetProfile,
    GameSession,
    Payline,
    ReelStrip,
    Spin,
    Symbol,
    SymbolPayout,
)


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "volatility", "is_active")
    list_filter = ("is_active", "volatility")
    search_fields = ("name", "slug")


admin.site.register(Symbol)
admin.site.register(Payline)
admin.site.register(SymbolPayout)
admin.site.register(ReelStrip)
admin.site.register(GameSession)
admin.site.register(GameBetProfile)
admin.site.register(DropJackpot)


@admin.register(Spin)
class SpinAdmin(admin.ModelAdmin):
    list_display = ("id", "game", "bet_amount", "win_amount", "status", "created_at")
    list_filter = ("status", "game")
    readonly_fields = [f.name for f in Spin._meta.fields]  # solo lectura en admin
