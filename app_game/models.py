"""
Motor del juego (slot 3x3).

PRINCIPIO INNEGOCIABLE: el resultado del spin se calcula EN EL SERVIDOR.
El cliente (React + Phaser) solo RENDERIZA la matriz que el servidor decidió.
Nunca confíes en el cliente para determinar símbolos ni premios: un jugador
puede inspeccionar y manipular todo lo que corra en su navegador.

El "corazón matemático" (probabilidades -> RTP y volatilidad) vive en ReelStrip.
Ese modelo es lo que un laboratorio (GLI, iTech Labs, BMM) debe certificar.
"""
from django.conf import settings
from django.db import models

from common.models import BaseModel


class Volatility(models.TextChoices):
    LOW = "LOW", "Baja"
    MEDIUM = "MEDIUM", "Media"
    HIGH = "HIGH", "Alta"


class WinMode(models.TextChoices):
    LINES = "LINES", "Líneas de pago fijas"
    WAYS = "WAYS", "Ways to win (adyacencia en rodillos)"
    # MEGAWAYS (filas variables por rodillo en cada spin) es una evolución futura:
    # exige matrices "irregulares" y recalcular las ways en cada tirada.


class BackgroundType(models.TextChoices):
    COLOR = "COLOR", "Color fijo"
    GRADIENT = "GRADIENT", "Degradado"
    IMAGE = "IMAGE", "Imagen o GIF"
    VIDEO = "VIDEO", "Video"


class Game(BaseModel):
    """
    Definición de un juego. La rejilla es CONFIGURABLE: no está atada a 3x3.

    Semántica de la rejilla (evita la ambigüedad de "3x5"):
      - grid_cols = nº de RODILLOS (columnas que giran).  Ej.: 5
      - grid_rows = SÍMBOLOS visibles por rodillo (filas). Ej.: 3
    Un slot clásico "5x3" => grid_cols=5, grid_rows=3. Un 3x3 => 3 y 3.
    El motor y el cliente (Phaser) deben LEER estas dimensiones, nunca asumir 3x3.
    """

    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    description = models.TextField(blank=True)

    grid_cols = models.PositiveSmallIntegerField(
        default=3, help_text="Nº de rodillos (columnas). Ej.: 3, 5, 6."
    )
    grid_rows = models.PositiveSmallIntegerField(
        default=3, help_text="Símbolos visibles por rodillo (filas). Ej.: 3, 4."
    )
    win_mode = models.CharField(
        max_length=10,
        choices=WinMode.choices,
        default=WinMode.LINES,
        help_text="LINES: líneas fijas (usa Payline). WAYS: adyacencia (ignora Payline).",
    )

    volatility = models.CharField(
        max_length=10, choices=Volatility.choices, default=Volatility.MEDIUM
    )
    max_win_multiplier = models.PositiveIntegerField(
        default=1000, help_text="Tope de pago como múltiplo de la apuesta total."
    )
    is_active = models.BooleanField(default=True)

    # Tema visual (el cliente lo usa para renderizar; se puede reskinear sin código).
    is_template = models.BooleanField(default=False, help_text="Plantilla base para crear casinos.")
    title = models.CharField(max_length=120, blank=True, help_text="Título mostrado en el cliente.")
    background_color = models.CharField(max_length=9, default="#0b0f1a", help_text="Color de fondo del tema.")
    accent_color = models.CharField(
        max_length=9, default="#ffd23f", help_text="Color que predomina (marcos, glow, acentos)."
    )
    background_type = models.CharField(
        max_length=10, choices=BackgroundType.choices, default=BackgroundType.COLOR,
        help_text="Tipo de fondo: color, degradado, imagen/gif o video.",
    )
    background_gradient = models.CharField(
        max_length=220, blank=True, default="",
        help_text="Colores del degradado separados por coma. Ej: '#180a2e,#05030f'.",
    )

    # Imagen de perfil del juego (para identificarlo en el lobby / listados).
    thumbnail = models.ImageField(
        upload_to="themes/thumbs/", blank=True, null=True, help_text="Imagen de perfil (lobby)."
    )

    # Chrome del casino (assets subibles): el cliente Phaser los dibuja si existen.
    background_image = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Fondo a pantalla completa (imagen o gif)."
    )
    background_video = models.FileField(
        upload_to="themes/video/", blank=True, null=True, help_text="Fondo en video (mp4/webm)."
    )
    logo = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Logo superior (sustituye al título)."
    )
    prize_banner = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Banner del premio (bajo la rejilla)."
    )
    spin_button = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Imagen del botón de girar."
    )
    music_on = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Icono música activada."
    )
    music_off = models.ImageField(
        upload_to="themes/", blank=True, null=True, help_text="Icono música silenciada."
    )
    music_track = models.FileField(
        upload_to="themes/audio/", blank=True, null=True, help_text="Pista de música de fondo (loop)."
    )
    # Iconos de los botones de control (opcionales; si faltan se dibujan por defecto).
    turbo_on = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón turbo activo.")
    turbo_off = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón turbo inactivo.")
    auto_on = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón autoplay activo.")
    auto_off = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón autoplay inactivo.")
    bet_plus = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón subir apuesta.")
    bet_minus = models.ImageField(upload_to="themes/", blank=True, null=True, help_text="Botón bajar apuesta.")

    class Meta:
        db_table = "game"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.slug}) {self.grid_cols}x{self.grid_rows}"

    @property
    def reels(self) -> int:
        return self.grid_cols

    @property
    def rows(self) -> int:
        return self.grid_rows

    @property
    def ways_count(self) -> int:
        """Nº de 'ways' en rejilla uniforme: filas ** rodillos (3^5 = 243)."""
        return self.grid_rows ** self.grid_cols

    def validate_configuration(self) -> list[str]:
        """
        Comprueba la coherencia de la configuración ANTES de activar el juego.
        Devuelve lista de errores (vacía = OK). Úsalo antes de poner is_active=True.
        """
        errors = []
        # 1) Debe existir una banda por cada rodillo, por cada versión de math.
        versions = self.reel_strips.values_list("math_version", flat=True).distinct()
        for version in versions:
            indices = sorted(
                self.reel_strips.filter(math_version=version).values_list(
                    "reel_index", flat=True
                )
            )
            if indices != list(range(self.grid_cols)):
                errors.append(
                    f"math_version '{version}': se esperan bandas para los rodillos "
                    f"0..{self.grid_cols - 1}, se encontraron {indices}."
                )
        # 2) En modo LINES, cada patrón cubre todos los rodillos con filas válidas.
        if self.win_mode == WinMode.LINES:
            for line in self.paylines.all():
                if len(line.pattern) != self.grid_cols:
                    errors.append(
                        f"Línea {line.index}: patrón de longitud {len(line.pattern)}, "
                        f"se esperan {self.grid_cols} (uno por rodillo)."
                    )
                elif any(r < 0 or r >= self.grid_rows for r in line.pattern):
                    errors.append(
                        f"Línea {line.index}: fila fuera de rango "
                        f"0..{self.grid_rows - 1}: {line.pattern}."
                    )
        return errors


class Symbol(BaseModel):
    game = models.ForeignKey(Game, related_name="symbols", on_delete=models.CASCADE)
    code = models.CharField(
        max_length=20, help_text="Identificador corto en la matriz: 'A', 'K', 'WILD'..."
    )
    name = models.CharField(max_length=60)
    asset_key = models.CharField(
        max_length=120, blank=True, help_text="Clave del sprite en el cliente Phaser."
    )
    is_wild = models.BooleanField(default=False)
    is_scatter = models.BooleanField(default=False)
    weight = models.PositiveSmallIntegerField(
        default=1, help_text="Frecuencia del símbolo en la banda (mayor = más común, menos premio)."
    )
    image = models.ImageField(
        upload_to="symbols/", null=True, blank=True, help_text="Sprite del símbolo (tema)."
    )

    class Meta:
        db_table = "game_symbol"
        unique_together = ("game", "code")

    def __str__(self):
        return f"{self.game.slug}:{self.code}"


class Payline(BaseModel):
    """
    Línea de pago (solo aplica cuando Game.win_mode == LINES).

    El patrón tiene UNA entrada por rodillo (longitud = grid_cols) indicando la
    fila elegida en ese rodillo. Se adapta a cualquier tamaño de rejilla.
    """

    game = models.ForeignKey(Game, related_name="paylines", on_delete=models.CASCADE)
    index = models.PositiveSmallIntegerField(help_text="Identificador/orden de la línea (0..n).")
    pattern = models.JSONField(
        help_text=(
            "Fila por rodillo, longitud = grid_cols. "
            "Ej. 3 rodillos: [0,0,0] fila superior, [0,1,2] diagonal. "
            "Ej. 5 rodillos: [1,1,1,1,1] fila central."
        )
    )

    class Meta:
        db_table = "game_payline"
        unique_together = ("game", "index")
        ordering = ["index"]

    def __str__(self):
        return f"{self.game.slug} línea {self.index} {self.pattern}"


class SymbolPayout(BaseModel):
    """Tabla de pagos: cuántas coincidencias de un símbolo pagan qué múltiplo."""

    game = models.ForeignKey(Game, related_name="payouts", on_delete=models.CASCADE)
    symbol = models.ForeignKey(Symbol, related_name="payouts", on_delete=models.CASCADE)
    count = models.PositiveSmallIntegerField(
        help_text="Nº de símbolos en línea (para 3x3 normalmente 3)."
    )
    multiplier = models.DecimalField(
        max_digits=10, decimal_places=2, help_text="Múltiplo de la apuesta por línea."
    )

    class Meta:
        db_table = "game_symbol_payout"
        unique_together = ("game", "symbol", "count")

    def __str__(self):
        return f"{self.symbol.code} x{self.count} => {self.multiplier}"


class ReelStrip(BaseModel):
    """
    Rodillo virtual (banda). La secuencia y la repetición de símbolos definen la
    probabilidad de cada símbolo y, por tanto, el RTP y la volatilidad.

    Se versiona con `math_version`: un cambio en las bandas es un cambio del modelo
    matemático y, en mercado regulado, exige nueva certificación.

    Debe existir UNA banda por cada rodillo (reel_index 0..grid_cols-1) para cada
    math_version. Game.validate_configuration() lo verifica.
    """

    game = models.ForeignKey(Game, related_name="reel_strips", on_delete=models.CASCADE)
    math_version = models.CharField(
        max_length=40, help_text="Versión del modelo matemático (debe coincidir con la config RTP)."
    )
    reel_index = models.PositiveSmallIntegerField(help_text="Columna 0..cols-1.")
    strip = models.JSONField(
        help_text="Lista ordenada de códigos de símbolo. Ej: ['A','K','WILD','A','Q',...]."
    )

    class Meta:
        db_table = "game_reel_strip"
        unique_together = ("game", "math_version", "reel_index")
        ordering = ["math_version", "reel_index"]

    def __str__(self):
        return f"{self.game.slug} v{self.math_version} reel {self.reel_index}"


class GameSession(BaseModel):
    """
    Sesión de juego. Puede pertenecer a:
      - un jugador INTERNO (player_user, modo plataforma propia), o
      - una sesión de OPERADOR externo (player_session, modo proveedor).
    """

    game = models.ForeignKey(Game, related_name="sessions", on_delete=models.PROTECT)
    player_session = models.ForeignKey(
        "app_wallet_integration.PlayerSession",
        related_name="game_sessions",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        help_text="Operador externo (modo proveedor). Nulo si es jugador interno.",
    )
    player_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="game_sessions",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        help_text="Jugador interno (modo plataforma propia). Nulo si es operador externo.",
    )
    currency = models.CharField(max_length=3, default="USD")
    is_open = models.BooleanField(default=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    # Estado de mecánicas CON MEMORIA entre tiros dentro de la misma sesión (p. ej.
    # tiradas gratis restantes y multiplicador acumulado). Vacío = juego base sin
    # ronda de feature activa. El motor lee/escribe aquí; el cliente solo lo refleja.
    feature_state = models.JSONField(
        default=dict,
        blank=True,
        help_text="Estado de features con memoria (ej. {'free_spins': {'remaining': 7, 'multiplier': '3.00'}}).",
    )

    class Meta:
        db_table = "game_session"

    def __str__(self):
        return f"session {self.id}"


class SpinStatus(models.TextChoices):
    PENDING = "PENDING", "Pendiente"
    SETTLED = "SETTLED", "Liquidado"
    VOIDED = "VOIDED", "Anulado"


class Spin(BaseModel):
    """
    Registro operativo de una tirada. Es la fuente del log inmutable de auditoría.
    Los montos van en UNIDADES MENORES (céntimos) como enteros.
    """

    game = models.ForeignKey(Game, related_name="spins", on_delete=models.PROTECT)
    game_session = models.ForeignKey(
        GameSession, related_name="spins", on_delete=models.PROTECT
    )
    rtp_config = models.ForeignKey(
        "app_rtp.RTPConfiguration", related_name="spins", on_delete=models.PROTECT
    )
    math_version = models.CharField(max_length=40)

    bet_amount = models.BigIntegerField(help_text="Apuesta total en céntimos.")
    win_amount = models.BigIntegerField(default=0, help_text="Premio total en céntimos.")
    currency = models.CharField(max_length=3, default="USD")
    lines_played = models.PositiveSmallIntegerField(default=1)

    matrix_result = models.JSONField(
        help_text="Matriz 3x3 resultante. Ej: [['A','K','A'],['Q','WILD','Q'],['A','A','A']]."
    )
    winning_lines = models.JSONField(
        default=list, help_text="Detalle de líneas ganadoras y sus premios."
    )

    rng_algorithm = models.CharField(max_length=40, default="secrets.SystemRandom")
    rng_seed = models.CharField(
        max_length=128, blank=True, help_text="Semilla/estado para reproducibilidad y prueba."
    )
    status = models.CharField(
        max_length=10, choices=SpinStatus.choices, default=SpinStatus.PENDING
    )

    class Meta:
        db_table = "game_spin"
        indexes = [models.Index(fields=["game", "created_at"])]

    def __str__(self):
        return f"spin {self.id} bet={self.bet_amount} win={self.win_amount}"


class GameBetProfile(BaseModel):
    """
    Escalera de apuestas por juego y moneda.

    Las denominaciones se definen POR MONEDA para que las apuestas sean valores
    "redondos" y con sentido local: no quieres convertir una apuesta de €1 y que
    en Japón salga ¥152,37. La MATEMÁTICA (RTP, bandas) es la MISMA para todas las
    monedas porque opera sobre MULTIPLICADORES; solo cambian las denominaciones.
    Montos en unidades menores (ver common.Currency.exponent).
    """

    game = models.ForeignKey(Game, related_name="bet_profiles", on_delete=models.CASCADE)
    currency = models.CharField(max_length=10)
    min_bet = models.BigIntegerField(help_text="Apuesta mínima en unidades menores.")
    max_bet = models.BigIntegerField(help_text="Apuesta máxima en unidades menores.")
    default_bet = models.BigIntegerField(help_text="Apuesta por defecto en unidades menores.")
    bet_levels = models.JSONField(
        default=list,
        help_text="Niveles de apuesta permitidos, en unidades menores. Ej: [50,100,200,500].",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "game_bet_profile"
        unique_together = ("game", "currency")

    def __str__(self):
        return f"{self.game.slug} · {self.currency}"


class DropJackpot(BaseModel):
    """
    Drop Jackpot (jackpot aleatorio). Se evalúa con probabilidad FIJA y baja en
    tiros YA pagados. El disparo depende solo del RNG, no del jugador ni de su
    historial => independiente y certificable.

    NOTA RTP: el premio del jackpot SUMA al retorno. El modelo matemático debe
    contemplar esta contribución para que el RTP TOTAL (base + jackpot) sea el
    declarado. Un jackpot PROGRESIVO/pooled (contribución por apuesta + pool
    acumulado) es una evolución futura; aquí el premio es fijo (MVP).
    """

    game = models.OneToOneField(Game, related_name="drop_jackpot", on_delete=models.CASCADE)
    is_active = models.BooleanField(default=False)
    trigger_probability = models.DecimalField(
        max_digits=12,
        decimal_places=10,
        help_text="Prob. de disparo por tiro pagado. Ej: 0.0001000000 = 1 entre 10.000.",
    )
    award_amount = models.BigIntegerField(help_text="Premio fijo en unidades menores (MVP).")
    currency = models.CharField(max_length=10, default="USD")

    class Meta:
        db_table = "game_drop_jackpot"

    def __str__(self):
        return f"jackpot {self.game.slug} p={self.trigger_probability}"


class OperatorGame(BaseModel):
    """
    Catálogo POR OPERADOR: qué juegos puede ofrecer/lanzar cada operador.

    Es el núcleo del aislamiento multi-tenant: un operador solo ve y lanza los juegos
    que le fueron asignados. El mismo juego (propiedad del proveedor/NewCo) puede
    asignarse a varios operadores sin duplicar su matemática ni su certificación.
    Permite además reordenar el catálogo por operador sin tocar el juego base.
    """

    operator = models.ForeignKey(
        "app_wallet_integration.Operator", related_name="games", on_delete=models.CASCADE
    )
    game = models.ForeignKey(Game, related_name="operator_assignments", on_delete=models.CASCADE)
    is_enabled = models.BooleanField(
        default=True, help_text="Si el operador puede lanzar este juego ahora mismo."
    )
    sort_order = models.PositiveSmallIntegerField(default=0, help_text="Orden en el lobby del operador.")

    class Meta:
        db_table = "operator_game"
        unique_together = ("operator", "game")
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.operator_id} → {self.game.slug}"


class FreeSpinsFeature(BaseModel):
    """
    Mecánica de TIRADAS GRATIS (free spins). OPCIONAL por juego.

    Se dispara cuando aparecen >= `trigger_scatter_count` símbolos scatter (Symbol
    con is_scatter=True). Cada disparo otorga `spins_awarded` tiros con apuesta 0 y
    aplica `multiplier` a los premios de la ronda. Si `retrigger`, volver a juntar los
    scatters durante la ronda añade más tiros.

    ESTADO: solo la CONFIGURACIÓN vive aquí. El estado en curso (tiros restantes,
    multiplicador activo) va en GameSession.feature_state, porque es por sesión/jugador.

    RTP: las tiradas gratis aportan una parte importante del RTP en slots modernos. El
    modelo matemático (bandas + paytable) debe contemplar esta contribución para que el
    RTP TOTAL (base + feature) sea el declarado. Se verifica en simulate_game_rtp.

    NOTA: esto es el ESQUEMA para que la mecánica encaje sin retrabajo. La evaluación
    en el motor (engine.py) y el render en Phaser son la implementación completa, que
    va aparte.
    """

    game = models.OneToOneField(Game, related_name="free_spins", on_delete=models.CASCADE)
    is_active = models.BooleanField(default=False)
    trigger_scatter_count = models.PositiveSmallIntegerField(
        default=3, help_text="Nº de scatters para disparar la ronda."
    )
    spins_awarded = models.PositiveSmallIntegerField(
        default=10, help_text="Tiros gratis otorgados por disparo."
    )
    multiplier = models.DecimalField(
        max_digits=6, decimal_places=2, default=1, help_text="Multiplicador aplicado a los premios de la ronda."
    )
    retrigger = models.BooleanField(
        default=True, help_text="Si juntar scatters durante la ronda añade más tiros."
    )

    class Meta:
        db_table = "game_free_spins_feature"

    def __str__(self):
        return f"free_spins {self.game.slug} x{self.spins_awarded}@{self.multiplier}"


class FreeRoundStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Activa"
    DEPLETED = "DEPLETED", "Consumida"
    EXPIRED = "EXPIRED", "Caducada"
    CANCELLED = "CANCELLED", "Cancelada"


class FreeRoundGrant(BaseModel):
    """
    TIRADAS GRATIS OTORGADAS a un jugador CONCRETO en un slot concreto (distinto de
    las que dispara el scatter). Las concede el master (desde el panel) o el operador
    (por API, por `player_id`). No es fun-money: en modo seamless los premios se
    ACREDITAN de verdad en la billetera del operador; solo NO se cobra la apuesta.

    Cada ronda gratis se juega a `bet_amount` FIJO (definido al conceder, por defecto
    la apuesta por defecto del juego) y aplica `win_multiplier` a los premios. Se
    consumen de una en una en el flujo normal de giro cuando el jugador abre ese slot.
    """

    # Jugador de OPERADOR externo (operator + external_player_id) o INTERNO (player_user).
    operator = models.ForeignKey(
        "app_wallet_integration.Operator", related_name="free_round_grants",
        on_delete=models.CASCADE, null=True, blank=True,
    )
    external_player_id = models.CharField(max_length=120, blank=True, default="")
    player_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="free_round_grants",
        on_delete=models.CASCADE, null=True, blank=True,
    )

    game = models.ForeignKey(Game, related_name="free_round_grants", on_delete=models.CASCADE)
    currency = models.CharField(max_length=3, default="USD")

    bet_amount = models.BigIntegerField(help_text="Apuesta FIJA por ronda gratis (unidades menores).")
    total = models.PositiveIntegerField(help_text="Tiradas gratis concedidas.")
    remaining = models.PositiveIntegerField(help_text="Tiradas gratis sin consumir.")
    win_multiplier = models.PositiveSmallIntegerField(default=1)

    status = models.CharField(max_length=12, choices=FreeRoundStatus.choices, default=FreeRoundStatus.ACTIVE)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Nulo = sin caducidad.")
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        db_table = "game_free_round_grant"
        indexes = [
            models.Index(fields=["operator", "external_player_id", "game", "status"]),
            models.Index(fields=["player_user", "game", "status"]),
        ]

    def __str__(self):
        who = self.external_player_id or (self.player_user_id and f"user:{self.player_user_id}") or "?"
        return f"freerounds {who} {self.game.slug} {self.remaining}/{self.total}"

    def is_consumable(self):
        from django.utils import timezone
        if self.status != FreeRoundStatus.ACTIVE or self.remaining <= 0:
            return False
        if self.expires_at is not None and self.expires_at <= timezone.now():
            return False
        return True
