"""
Servicio de tasas de cambio para REPORTING (nunca para el juego).

Se conecta por WEBSOCKET a investing.com/forexpros (mismo mecanismo que BuffonBet) y
escribe SNAPSHOTS en FxRate (base=USD, quote=<code>) a medida que llegan cotizaciones.
Los reportes leen el último snapshot. Pensado para correr permanente bajo supervisorctl.

Suscripción: se usan los `investing_pid` de las monedas activas (common.Currency). Las
monedas sin pid no se cotizan en vivo (saldrán "sin tasa" en los reportes).

Uso:
  # Servicio en vivo (supervisorctl):
  python manage.py load_fx_rates
  # Carga puntual offline para demo/pruebas (sin red), tasas = locales por 1 USD:
  python manage.py load_fx_rates --manual "MXN=18.34,CLP=955,ARS=1450,BRL=5.35"

DISEÑO: FxRate es histórico e INMUTABLE. El websocket empuja muchos ticks; NO se
escribe uno por tick (inundaría la tabla). Se escribe como mucho un snapshot por
moneda cada `--min-interval` segundos. El punto más reciente es la tasa "vigente".

NOTA: el parser del mensaje (formato SockJS de forexpros) y la URL del stream vienen
de BuffonBet. Los segmentos de la URL (server/sesión) pueden rotar; si deja de llegar
nada, refresca --stream-url. Sustituir esta fuente por otra solo requiere cambiar el
handler; el resto (throttle + escritura en FxRate) queda igual.
"""
import json
import time
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from common.models import Currency
from app_wallet_integration.models import FxRate

DEFAULT_STREAM_URL = "wss://streaming.forexpros.com/echo/646/nvio1auo/websocket"


class Command(BaseCommand):
    help = "Carga tasas de cambio (base USD) en FxRate vía websocket de investing.com."

    def add_arguments(self, parser):
        parser.add_argument("--manual", type=str, default="",
                            help='Carga puntual offline: "CODE=rate,..." (locales por 1 USD).')
        parser.add_argument("--stream-url", type=str, default=DEFAULT_STREAM_URL,
                            help="URL del websocket de forexpros/investing.")
        parser.add_argument("--min-interval", type=int, default=300,
                            help="Segundos mínimos entre snapshots de una misma moneda.")
        parser.add_argument("--source-label", type=str, default="",
                            help="Etiqueta guardada en FxRate.source.")

    def handle(self, *args, **opts):
        if opts["manual"]:
            self._load_manual(opts["manual"], opts["source_label"] or "manual")
            return
        self._run_websocket(opts["stream_url"], opts["min_interval"],
                            opts["source_label"] or "investing.com")

    # ------------------------------------------------------------------ #
    def _write_rate(self, code, rate, source):
        FxRate.objects.update_or_create(
            base_currency="USD", quote_currency=code.upper(),
            effective_at=timezone.now(), source=source,
            defaults={"rate": rate},
        )

    def _load_manual(self, text, source):
        rates = {}
        for pair in text.split(","):
            if "=" not in pair:
                continue
            code, _, val = pair.partition("=")
            try:
                rates[code.strip().upper()] = Decimal(val.strip())
            except InvalidOperation:
                raise CommandError(f"Tasa inválida para {code!r}: {val!r}")
        if not rates:
            raise CommandError("--manual no contiene tasas válidas.")
        n = 0
        for code in Currency.objects.filter(is_active=True).values_list("code", flat=True):
            code = code.upper()
            if code == "USD":
                self._write_rate("USD", Decimal(1), source); n += 1
            elif code in rates:
                self._write_rate(code, rates[code], source); n += 1
        self.stdout.write(self.style.SUCCESS(f"Snapshot manual: {n} monedas."))

    # ------------------------------------------------------------------ #
    def _run_websocket(self, stream_url, min_interval, source):
        try:
            import rel
            import websocket
        except ImportError as exc:
            raise CommandError(
                "Faltan dependencias del websocket. Instala: pip install websocket-client rel"
            ) from exc

        # pid -> code de las monedas activas con pid. USD es base, no se suscribe.
        pid_to_code = {
            c.investing_pid: c.code.upper()
            for c in Currency.objects.filter(is_active=True).exclude(investing_pid="")
        }
        if not pid_to_code:
            raise CommandError(
                "Ninguna moneda activa tiene investing_pid. Complétalos en Currency."
            )
        # USD siempre disponible como base.
        if Currency.objects.filter(code="USD", is_active=True).exists():
            self._write_rate("USD", Decimal(1), source)

        last_written = {}  # code -> timestamp del último snapshot (throttle)

        def on_message(ws, message):
            try:
                if message[:4] != 'a["{':
                    return
                result = eval(message.replace('"{', "'{").replace('}"', "}'")[1:])
                payload = eval(result[0])["message"].split("::")[1]
                data = json.loads(payload)
                pid = str(data.get("pid"))
                code = pid_to_code.get(pid)
                if not code or data.get("last") in (None, ""):
                    return
                now = time.time()
                if now - last_written.get(code, 0) < min_interval:
                    return  # throttle: no floodear el histórico
                rate = Decimal(str(data["last"]))
                self._write_rate(code, rate, source)
                last_written[code] = now
                self.stdout.write(f"[{timezone.now():%H:%M:%S}] {code} = {rate} (pid {pid})")
            except Exception as exc:  # un mensaje malformado no debe tumbar el servicio
                self.stderr.write(f"msg ignorado: {exc}")

        def on_open(ws):
            ids = "%%".join(f"pid-{pid}:" for pid in pid_to_code)
            ws.send('{"_event":"bulk-subscribe","tzID":8,"message":"%s"}' % ids)
            self.stdout.write(self.style.SUCCESS(
                f"Conectado. Suscrito a {len(pid_to_code)} monedas: {sorted(pid_to_code.values())}"
            ))

        def on_error(ws, error):
            self.stderr.write(f"ws error: {error}")

        def on_close(ws, code, msg):
            self.stdout.write("ws cerrado")

        self.stdout.write(f"Conectando a {stream_url} …")
        ws = websocket.WebSocketApp(
            stream_url, on_open=on_open, on_message=on_message,
            on_error=on_error, on_close=on_close,
        )
        ws.run_forever(dispatcher=rel, reconnect=5)
        rel.signal(2, rel.abort)
        rel.dispatch()
