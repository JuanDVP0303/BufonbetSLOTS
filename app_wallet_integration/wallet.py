"""
Clientes de billetera.

DEMO (fun-money): billetera INTERNA sin I/O externo. El saldo lo lleva SlotForge.

SEAMLESS (dinero real): en cada tiro SlotForge llama por HTTP a la billetera del
operador para DEBITAR la apuesta y ACREDITAR el premio. El saldo real vive en el
operador; SlotForge solo lo mueve. Las llamadas van FIRMADAS con HMAC-SHA256 para que
el operador verifique que vienen de nosotros. La idempotencia (idempotency_key única
por tiro) evita duplicar débitos/créditos en reintentos.

Contrato del operador (3 endpoints que EXPONE el operador y que NOSOTROS llamamos):
    POST {wallet_base_url}/slotforge/wallet/debit/
    POST {wallet_base_url}/slotforge/wallet/credit/
    POST {wallet_base_url}/slotforge/wallet/rollback/
    Header:  X-SlotForge-Signature: <hmac_sha256_hex(body, secret)>
    Body:    {"player_id","amount","currency","idempotency_key","round_id"}
    Respuesta OK (200): {"balance": <int menor>, "external_reference": "<str>"}
    Saldo insuficiente: 402 (o {"error":"insufficient_funds"}) => se rechaza el tiro.
"""
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

from .models import WalletMode


class WalletError(Exception):
    """Fallo genérico de billetera (red, 5xx, respuesta inválida)."""


class InsufficientWalletFunds(WalletError):
    """El operador rechazó el débito por saldo insuficiente."""


class BaseWalletClient:
    def debit(self, *, external_player_id, amount, currency, idempotency_key, reference):
        raise NotImplementedError

    def credit(self, *, external_player_id, amount, currency, idempotency_key, reference):
        raise NotImplementedError

    def rollback(self, *, external_player_id, amount, currency, idempotency_key, reference):
        raise NotImplementedError


class DemoWalletClient(BaseWalletClient):
    """Billetera interna para demo. Siempre confirma; no valida saldo real."""

    def debit(self, *, external_player_id, amount, currency, idempotency_key, reference):
        return {"status": "CONFIRMED", "external_reference": f"demo-debit-{idempotency_key}"}

    def credit(self, *, external_player_id, amount, currency, idempotency_key, reference):
        return {"status": "CONFIRMED", "external_reference": f"demo-credit-{idempotency_key}"}

    def rollback(self, *, external_player_id, amount, currency, idempotency_key, reference):
        return {"status": "CONFIRMED", "external_reference": f"demo-rollback-{idempotency_key}"}


class HttpWalletClient(BaseWalletClient):
    """
    Billetera REAL del operador (seamless). Llama a los endpoints del operador con
    firma HMAC. Devuelve el payload del operador (incluye `balance` real).
    """

    def __init__(self, operator, secret: str, timeout: int = 10):
        self.base = operator.wallet_base_url.rstrip("/")
        self.secret = secret.encode()
        self.timeout = timeout

    def _post(self, action, *, external_player_id, amount, currency, idempotency_key, reference):
        payload = {
            "player_id": external_player_id,
            "amount": int(amount),
            "currency": currency,
            "idempotency_key": idempotency_key,
            "round_id": reference,
        }
        # Firma sobre el body EXACTO que se envía (bytes), sin espacios.
        body = json.dumps(payload, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        url = f"{self.base}/slotforge/wallet/{action}/"
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Content-Type": "application/json", "X-SlotForge-Signature": signature},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode()
            except Exception:
                pass
            if exc.code == 402 or "insufficient" in detail.lower():
                raise InsufficientWalletFunds(detail or "Saldo insuficiente en el operador.")
            raise WalletError(f"Billetera del operador respondió {exc.code}: {detail}")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise WalletError(f"No se pudo contactar la billetera del operador: {exc}")

    def debit(self, **kw):
        return self._post("debit", **kw)

    def credit(self, **kw):
        return self._post("credit", **kw)

    def rollback(self, **kw):
        return self._post("rollback", **kw)


def resolve_wallet_secret(operator):
    """
    Secreto HMAC del operador. `webhook_hmac_secret_ref` es preferentemente el NOMBRE
    de una variable de entorno que contiene el secreto (no se guarda el valor en la
    BD). Como comodidad de demo, si no existe esa env var se usa el propio valor como
    secreto literal.
    """
    ref = (operator.webhook_hmac_secret_ref or "").strip()
    if not ref:
        return None
    return os.environ.get(ref) or ref


def get_wallet_client(operator):
    """
    Devuelve el cliente de billetera del operador según su `wallet_mode`.
    SEAMLESS exige `wallet_base_url` y un secreto resoluble; si falta algo, error claro.
    """
    if operator.wallet_mode == WalletMode.SEAMLESS:
        secret = resolve_wallet_secret(operator)
        if not operator.wallet_base_url or not secret:
            raise WalletError(
                "Operador en modo SEAMLESS sin wallet_base_url o secreto HMAC configurado."
            )
        return HttpWalletClient(operator, secret)
    return DemoWalletClient()
