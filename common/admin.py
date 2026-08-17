from django.contrib import admin

from .models import Currency


@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    # investing_pid e is_active editables en línea: así cargas monedas y sus pids
    # sin entrar a cada una y el servicio load_fx_rates los toma al (re)arrancar.
    list_display = ("code", "name", "exponent", "symbol", "investing_pid", "is_crypto", "is_active")
    list_editable = ("investing_pid", "is_active")
    list_filter = ("is_active", "is_crypto")
    search_fields = ("code", "name", "investing_pid")
