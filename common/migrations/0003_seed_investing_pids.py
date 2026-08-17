"""
Siembra los pid de investing.com para las monedas que los tienen (reutilizados del
proyecto BuffonBet). Las que no tienen pid quedan vacías y saldrán "sin tasa" en los
reportes hasta que se complete su pid (mismo patrón TODO que BuffonBet).
"""
from django.db import migrations

# code -> pid de investing.com (par USD/<code>). USD es base (rate=1), no necesita pid.
PIDS = {
    "ARS": "2090",
    "BRL": "2103",
    "CLP": "2110",
    "MXN": "39",
    # Pendientes de pid (investing): CAD, COP, EUR, GBP, PEN.
}


def seed(apps, schema_editor):
    Currency = apps.get_model("common", "Currency")
    for code, pid in PIDS.items():
        Currency.objects.filter(code=code).update(investing_pid=pid)


def unseed(apps, schema_editor):
    Currency = apps.get_model("common", "Currency")
    Currency.objects.filter(code__in=PIDS).update(investing_pid="")


class Migration(migrations.Migration):
    dependencies = [("common", "0002_currency_investing_pid")]
    operations = [migrations.RunPython(seed, unseed)]
