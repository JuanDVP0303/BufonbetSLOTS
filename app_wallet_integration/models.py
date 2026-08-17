"""
Integración con la billetera del casino y autenticación de sesiones del iframe.

Flujo típico "seamless wallet":
1. El casino abre el iframe con un token de UN SOLO USO y corta vida en la URL.
2. Este servicio verifica el token contra el operador (firma + expiración + jti no usado)
   y crea una PlayerSession. El saldo real vive en el casino, no aquí.
3. Por cada spin: DEBIT (apuesta) -> el motor calcula el resultado -> CREDIT (premio),
   contra la billetera del casino vía HTTP, con IDEMPOTENCIA y conciliación posterior.

Nota sobre secretos: NO guardes claves/secretos en claro en la BD. Guarda una
REFERENCIA a un gestor de secretos (Vault, AWS/GCP KMS/Secrets Manager).
"""
from django.db import models

from common.models import BaseModel


class WalletMode(models.TextChoices):
    DEMO = "DEMO", "Demo (saldo interno fun-money)"
    SEAMLESS = "SEAMLESS", "Seamless (billetera real del operador vía HTTP)"


class Operator(BaseModel):
    """Casino externo que integra el juego."""

    name = models.CharField(max_length=120)
    code = models.SlugField(max_length=60, unique=True)
    is_active = models.BooleanField(default=True)

    # DEMO: el saldo lo lleva SlotForge (fun-money). SEAMLESS: cada tiro llama a la
    # billetera del operador (debit/credit) por HTTP; el saldo real vive allí.
    wallet_mode = models.CharField(
        max_length=10, choices=WalletMode.choices, default=WalletMode.DEMO
    )

    wallet_base_url = models.URLField(
        help_text="Endpoint base de la billetera del casino para debit/credit/rollback."
    )
    allowed_iframe_origins = models.JSONField(
        default=list,
        help_text="Orígenes permitidos para embeber (CSP frame-ancestors y validación de postMessage).",
    )
    # NOTA: el operador NO tiene moneda por defecto. Es MULTIMONEDA: la moneda se
    # decide POR SESIÓN, la envía el operador en cada launch (currency="MXN"/"USD"/…)
    # y debe existir un GameBetProfile del juego para esa moneda.

    jwt_verifying_key_ref = models.CharField(
        max_length=200, blank=True,
        help_text="Referencia (no el valor) a la clave pública/secreto para verificar tokens del operador.",
    )
    webhook_hmac_secret_ref = models.CharField(
        max_length=200, blank=True,
        help_text="Referencia al secreto HMAC para firmar/verificar webhooks.",
    )

    class Meta:
        db_table = "wallet_operator"

    def __str__(self):
        return self.name


class OperatorApiKey(BaseModel):
    """
    Credencial SERVIDOR-A-SERVIDOR del operador para llamar a la API del proveedor
    (p. ej. lanzar sesiones de juego). Autentica al BACKEND del operador, no al jugador.

    SEGURIDAD: se guarda solo el HASH del secreto (SHA-256), nunca el valor en claro.
    Al crearla se muestra el secreto UNA sola vez. `prefix` es la parte visible (no
    secreta) que permite localizar la clave sin exponerla en logs ni en la BD.
    """

    operator = models.ForeignKey(Operator, related_name="api_keys", on_delete=models.CASCADE)
    label = models.CharField(max_length=80, blank=True, help_text="Nombre para identificar la clave (ej. 'prod', 'staging').")
    prefix = models.CharField(max_length=16, db_index=True, help_text="Parte visible de la clave (no secreta).")
    hashed_key = models.CharField(max_length=128, help_text="Hash SHA-256 del secreto. Nunca el valor en claro.")
    is_active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "wallet_operator_api_key"
        indexes = [models.Index(fields=["prefix", "is_active"])]

    def __str__(self):
        return f"apikey {self.prefix}… op={self.operator_id}"


class LaunchToken(BaseModel):
    """Token de un solo uso pasado por la URL del iframe para iniciar la sesión."""

    operator = models.ForeignKey(Operator, related_name="launch_tokens", on_delete=models.PROTECT)
    jti = models.CharField(
        max_length=128, unique=True, help_text="Identificador único del token (claim jti)."
    )
    external_player_id = models.CharField(max_length=120, help_text="ID del jugador en el casino.")
    game = models.ForeignKey("app_game.Game", related_name="launch_tokens", on_delete=models.PROTECT)
    currency = models.CharField(max_length=3, default="USD")

    is_used = models.BooleanField(default=False)
    used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(help_text="Corta vida (p.ej. 30-120s).")

    class Meta:
        db_table = "wallet_launch_token"
        indexes = [models.Index(fields=["operator", "is_used"])]

    def __str__(self):
        return f"token {self.jti} op={self.operator_id}"


class PlayerSession(BaseModel):
    operator = models.ForeignKey(Operator, related_name="player_sessions", on_delete=models.PROTECT)
    external_player_id = models.CharField(
        max_length=120, help_text="ID del jugador en el sistema del casino (user_id)."
    )
    launch_token = models.OneToOneField(
        LaunchToken, related_name="player_session", null=True, blank=True, on_delete=models.SET_NULL
    )
    currency = models.CharField(max_length=3, default="USD")

    is_active = models.BooleanField(default=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    # SALDO DEMO (unidades menores): solo para modo demo/fun-money. En integración
    # real de dinero, el saldo vive en la billetera del operador y llega por HTTP;
    # aquí NO se almacena. Este campo permite que el iframe muestre un saldo que sube
    # y baja con las tiradas sin billetera externa.
    demo_balance = models.BigIntegerField(default=0)

    class Meta:
        db_table = "wallet_player_session"
        indexes = [models.Index(fields=["operator", "external_player_id"])]

    def __str__(self):
        return f"{self.operator_id}:{self.external_player_id}"


class TransactionType(models.TextChoices):
    DEBIT = "DEBIT", "Débito (apuesta)"
    CREDIT = "CREDIT", "Crédito (premio)"
    ROLLBACK = "ROLLBACK", "Reverso"


class TransactionStatus(models.TextChoices):
    PENDING = "PENDING", "Pendiente"
    CONFIRMED = "CONFIRMED", "Confirmada"
    FAILED = "FAILED", "Fallida"
    ROLLED_BACK = "ROLLED_BACK", "Revertida"


class WalletTransaction(BaseModel):
    """
    Movimiento contra la billetera del casino.

    La IDEMPOTENCIA es crítica: un reintento (timeout, reconexión) NO debe duplicar
    débitos ni créditos. La unicidad (operator, idempotency_key) lo garantiza a nivel
    de BD. Los montos van en UNIDADES MENORES (céntimos) y siempre >= 0.
    """

    operator = models.ForeignKey(Operator, related_name="transactions", on_delete=models.PROTECT)
    player_session = models.ForeignKey(
        PlayerSession, related_name="transactions", on_delete=models.PROTECT
    )
    spin = models.ForeignKey(
        "app_game.Spin", related_name="transactions", null=True, blank=True, on_delete=models.PROTECT
    )

    type = models.CharField(max_length=10, choices=TransactionType.choices)
    amount = models.BigIntegerField(help_text="Monto en céntimos. Siempre >= 0.")
    currency = models.CharField(max_length=3, default="USD")

    idempotency_key = models.CharField(max_length=140)
    external_reference = models.CharField(
        max_length=140, blank=True, help_text="Referencia devuelta por la billetera del casino."
    )
    status = models.CharField(
        max_length=12, choices=TransactionStatus.choices, default=TransactionStatus.PENDING
    )

    request_payload = models.JSONField(default=dict)
    response_payload = models.JSONField(default=dict)

    class Meta:
        db_table = "wallet_transaction"
        constraints = [
            models.UniqueConstraint(
                fields=["operator", "idempotency_key"], name="uq_wallet_tx_idempotency"
            ),
        ]
        indexes = [models.Index(fields=["operator", "status"])]

    def __str__(self):
        return f"{self.type} {self.amount} {self.currency} [{self.status}]"


class FxRate(BaseModel):
    """
    Tipo de cambio HISTÓRICO para REPORTING y LIQUIDACIÓN — NO para el juego.

    Regla de oro: el jugador apuesta y cobra en SU moneda; NUNCA se convierte
    durante el juego. Estos tipos solo sirven para:
      - Consolidar métricas (GGR) de todas las monedas en una moneda base.
      - Liquidar con el operador si el contrato está pactado en otra moneda.
    Son históricos e inmutables: un informe viejo no debe cambiar porque hoy el
    cambio sea otro. Guarda cada punto con su `effective_at` y su `source`.
    """

    base_currency = models.CharField(max_length=10, help_text="Moneda origen, p.ej. EUR.")
    quote_currency = models.CharField(max_length=10, help_text="Moneda destino, p.ej. USD.")
    rate = models.DecimalField(
        max_digits=24, decimal_places=12, help_text="1 unidad de base = `rate` unidades de quote."
    )
    source = models.CharField(
        max_length=60, help_text="Proveedor del tipo (ECB, openexchange, manual...)."
    )
    effective_at = models.DateTimeField(help_text="Momento en que este tipo entra en vigor.")

    class Meta:
        db_table = "wallet_fx_rate"
        ordering = ["-effective_at"]
        indexes = [models.Index(fields=["base_currency", "quote_currency", "effective_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["base_currency", "quote_currency", "effective_at", "source"],
                name="uq_fx_rate_point",
            ),
        ]

    def __str__(self):
        return f"{self.base_currency}/{self.quote_currency}={self.rate} @ {self.effective_at:%Y-%m-%d}"
