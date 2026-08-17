from decimal import Decimal

from rest_framework import serializers


class SpinRequestSerializer(serializers.Serializer):
    game_session = serializers.UUIDField()
    bet_amount = serializers.IntegerField(min_value=1)
    idempotency_key = serializers.CharField(max_length=140)


class LaunchSerializer(serializers.Serializer):
    game = serializers.SlugField()


class ProviderLaunchSerializer(serializers.Serializer):
    """Launch de un operador externo (autenticado por API key)."""

    game = serializers.SlugField()
    external_player_id = serializers.CharField(max_length=120)
    # OBLIGATORIA y por sesión: el operador es multimoneda. La envía en cada launch
    # (MXN/USD/CLP…) y debe existir un GameBetProfile del juego para esa moneda.
    currency = serializers.CharField(max_length=3)
    # Saldo del jugador EN UNIDADES MENORES (céntimos). El operador lo manda en cada
    # launch y se sincroniza con el saldo mostrado (puente hacia el seamless wallet).
    # Si no se envía, se usa el saldo demo por defecto.
    balance = serializers.IntegerField(min_value=0, required=False, allow_null=True, default=None)


class GameCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    slug = serializers.SlugField(max_length=140)
    template = serializers.SlugField(required=False, default="demo-lines-3x3")
    title = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    background_color = serializers.CharField(max_length=9, required=False, default="#0b0f1a")


class PlaySpinSerializer(serializers.Serializer):
    game_session = serializers.UUIDField()
    bet_amount = serializers.IntegerField(min_value=1)


class EmbedSpinSerializer(serializers.Serializer):
    """Tirada desde el iframe: la sesión sale del token, no del body."""

    bet_amount = serializers.IntegerField(min_value=1)
    idempotency_key = serializers.CharField(max_length=140, required=False, allow_blank=True, default="")


# --------------------------------------------------------------------------- #
# Builder de casino totalmente configurable                                    #
# --------------------------------------------------------------------------- #
class SymbolSpecSerializer(serializers.Serializer):
    code = serializers.RegexField(r"^[A-Z0-9_]{1,20}$")
    name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    is_wild = serializers.BooleanField(required=False, default=False)
    is_scatter = serializers.BooleanField(required=False, default=False)
    weight = serializers.IntegerField(min_value=1, max_value=1000, required=False, default=1)


class PayoutSpecSerializer(serializers.Serializer):
    code = serializers.RegexField(r"^[A-Z0-9_]{1,20}$")
    count = serializers.IntegerField(min_value=1, max_value=10)
    multiplier = serializers.DecimalField(max_digits=10, decimal_places=4, min_value=Decimal("0"))


class BetProfileSpecSerializer(serializers.Serializer):
    currency = serializers.CharField(max_length=10)
    min_bet = serializers.IntegerField(min_value=1)
    max_bet = serializers.IntegerField(min_value=1)
    default_bet = serializers.IntegerField(min_value=1)
    bet_levels = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list
    )

    def validate(self, data):
        if not (data["min_bet"] <= data["default_bet"] <= data["max_bet"]):
            raise serializers.ValidationError("Debe cumplirse min_bet <= default_bet <= max_bet.")
        return data


class FreeSpinsSpecSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=False, default=False)
    trigger_scatter_count = serializers.IntegerField(min_value=2, max_value=10, required=False, default=3)
    spins_awarded = serializers.IntegerField(min_value=1, max_value=100, required=False, default=10)
    multiplier = serializers.IntegerField(min_value=1, max_value=100, required=False, default=1)
    retrigger = serializers.BooleanField(required=False, default=True)


class GameBuildSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    slug = serializers.SlugField(max_length=140)
    title = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    grid_cols = serializers.IntegerField(min_value=3, max_value=7)
    grid_rows = serializers.IntegerField(min_value=3, max_value=6)
    win_mode = serializers.ChoiceField(choices=["LINES", "WAYS"])
    volatility = serializers.ChoiceField(choices=["LOW", "MEDIUM", "HIGH"], required=False, default="MEDIUM")
    max_win_multiplier = serializers.IntegerField(min_value=1, required=False, default=1000)
    background_color = serializers.CharField(max_length=9, required=False, default="#0b0f1a")
    accent_color = serializers.CharField(max_length=9, required=False, default="#ffd23f")
    background_type = serializers.ChoiceField(
        choices=["COLOR", "GRADIENT", "IMAGE", "VIDEO"], required=False, default="COLOR"
    )
    background_gradient = serializers.CharField(max_length=220, required=False, allow_blank=True, default="")
    # RTP objetivo LIBRE: el proveedor decide (incluso 50% o promociones >100%).
    # El motor cuadra la paytable a este valor tras crear el casino.
    target_rtp = serializers.DecimalField(
        max_digits=6, decimal_places=4, min_value=Decimal("0.10"), max_value=Decimal("1.50")
    )
    symbols = SymbolSpecSerializer(many=True)
    payouts = PayoutSpecSerializer(many=True)
    paylines = serializers.ListField(
        child=serializers.ListField(child=serializers.IntegerField(min_value=0)),
        required=False, default=list,
    )
    bet_profiles = BetProfileSpecSerializer(many=True)
    free_spins = FreeSpinsSpecSerializer(required=False)

    def validate(self, data):
        codes = [s["code"] for s in data["symbols"]]
        if len(codes) < 3:
            raise serializers.ValidationError("Se requieren al menos 3 símbolos.")
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("Los códigos de símbolo no pueden repetirse.")
        if not any(not s["is_wild"] for s in data["symbols"]):
            raise serializers.ValidationError("Debe haber al menos un símbolo que NO sea comodín.")
        code_set = set(codes)
        for p in data["payouts"]:
            if p["code"] not in code_set:
                raise serializers.ValidationError(f"El pago referencia un símbolo inexistente: {p['code']}.")
            if p["count"] > data["grid_cols"]:
                raise serializers.ValidationError(
                    f"count={p['count']} supera el nº de rodillos ({data['grid_cols']})."
                )
        if not data["payouts"]:
            raise serializers.ValidationError("Se requiere al menos una combinación ganadora (payout).")
        if not data["bet_profiles"]:
            raise serializers.ValidationError("Se requiere al menos un perfil de apuesta (moneda).")
        # Las líneas (si se envían) deben cubrir todos los rodillos con filas válidas.
        for i, pat in enumerate(data.get("paylines") or []):
            if len(pat) != data["grid_cols"]:
                raise serializers.ValidationError(f"La línea {i} debe tener {data['grid_cols']} entradas.")
            if any(r >= data["grid_rows"] for r in pat):
                raise serializers.ValidationError(f"La línea {i} referencia filas fuera de rango.")
        # Tiradas gratis activas exigen al menos un símbolo scatter.
        fs = data.get("free_spins")
        if fs and fs.get("is_active") and not any(s.get("is_scatter") for s in data["symbols"]):
            raise serializers.ValidationError("Para tiradas gratis marca al menos un símbolo como scatter.")
        return data


class GameThemeSerializer(serializers.Serializer):
    """Edición del TEMA visual de un casino ya creado (no toca la matemática)."""

    title = serializers.CharField(max_length=120, required=False, allow_blank=True)
    background_color = serializers.CharField(max_length=9, required=False)
    accent_color = serializers.CharField(max_length=9, required=False)
    background_type = serializers.ChoiceField(
        choices=["COLOR", "GRADIENT", "IMAGE", "VIDEO"], required=False
    )
    background_gradient = serializers.CharField(max_length=220, required=False, allow_blank=True)
    # RTP objetivo (opcional): si viene, se recalibra la paytable del casino.
    target_rtp = serializers.DecimalField(
        max_digits=6, decimal_places=4, min_value=Decimal("0.10"), max_value=Decimal("1.50"),
        required=False,
    )
    # Tamaño de rejilla (opcional): si viene, regenera bandas/líneas y recalibra.
    grid_cols = serializers.IntegerField(min_value=3, max_value=7, required=False)
    grid_rows = serializers.IntegerField(min_value=3, max_value=6, required=False)


class FreeRoundGrantSerializer(serializers.Serializer):
    """(Master) Conceder tiradas gratis a un jugador de operador o interno."""

    game = serializers.SlugField()
    currency = serializers.CharField(max_length=3)
    quantity = serializers.IntegerField(min_value=1, max_value=100_000)
    # Jugador de OPERADOR (operator_code + external_player_id) o INTERNO (player_email).
    operator_code = serializers.SlugField(required=False, allow_blank=True, default="")
    external_player_id = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    player_email = serializers.EmailField(required=False, allow_blank=True, default="")
    bet_amount = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    win_multiplier = serializers.IntegerField(min_value=1, max_value=1000, required=False, default=1)
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate(self, data):
        has_operator_player = bool(data.get("operator_code") and data.get("external_player_id"))
        if not has_operator_player and not data.get("player_email"):
            raise serializers.ValidationError(
                "Indica (operator_code + external_player_id) para un jugador de operador, "
                "o player_email para un jugador interno."
            )
        return data


class ProviderFreeRoundSerializer(serializers.Serializer):
    """(Operador, API key) Conceder tiradas gratis a UNO de sus jugadores por id."""

    game = serializers.SlugField()
    player_id = serializers.CharField(max_length=120)
    currency = serializers.CharField(max_length=3)
    quantity = serializers.IntegerField(min_value=1, max_value=100_000)
    bet_amount = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    win_multiplier = serializers.IntegerField(min_value=1, max_value=1000, required=False, default=1)
    expires_at = serializers.DateTimeField(required=False, allow_null=True, default=None)


class OperatorCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    code = serializers.SlugField(max_length=60)
    wallet_base_url = serializers.URLField(required=False, allow_blank=True, default="")


class ApiKeyCreateSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")


class OperatorUserCreateSerializer(serializers.Serializer):
    """Cuenta de acceso (login) del back office de un operador."""

    email = serializers.EmailField()
    password = serializers.CharField(min_length=6, max_length=128)


class OperatorPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(min_length=6, max_length=128)


class OperatorGameAssignSerializer(serializers.Serializer):
    game = serializers.SlugField()
    is_enabled = serializers.BooleanField(required=False, default=True)


class SimulateSerializer(serializers.Serializer):
    spins = serializers.IntegerField(min_value=1000, max_value=1_000_000, required=False, default=100_000)
    bet_amount = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
