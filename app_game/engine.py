"""
SlotEngine: motor de cálculo del slot. PURO (sin dependencias de Django).

Diseño clave:
  - El motor opera sobre estructuras de datos planas (bandas, paytable, líneas).
    No conoce la BD ni al jugador. Esto lo hace testeable y CERTIFICABLE aislado.
  - RNG: por defecto secrets.SystemRandom (CSPRNG). En tests se inyecta un
    random.Random(seed) para obtener resultados deterministas.
  - Cada tiro es INDEPENDIENTE: las paradas se eligen sobre bandas FIJAS. El RTP
    emerge del diseño de las bandas + paytable, NO se ajusta en caliente por sesión
    (eso sería RTP compensado por jugador: prohibido y no certificable).

Para VERIFICAR el RTP de una configuración se usa `simulate_rtp()` (Monte Carlo),
no un lazo de realimentación en producción.
"""
from __future__ import annotations

import random
import secrets
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional, Sequence

# Modos de evaluación de premios.
LINES = "LINES"
WAYS = "WAYS"


# --------------------------------------------------------------------------- #
# Resultados (inmutables)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class LineWin:
    line_index: int
    symbol: str
    count: int
    multiplier: Decimal   # múltiplo de la apuesta POR LÍNEA
    amount: int           # premio en unidades menores (céntimos)

    def as_dict(self) -> dict:
        return {
            "kind": "LINE",
            "line_index": self.line_index,
            "symbol": self.symbol,
            "count": self.count,
            "multiplier": str(self.multiplier),
            "amount": self.amount,
        }


@dataclass(frozen=True)
class WaysWin:
    symbol: str
    count: int            # nº de rodillos consecutivos desde la izquierda
    ways: int             # nº de formas = producto de apariciones por rodillo
    multiplier: Decimal   # múltiplo base del símbolo para `count` rodillos
    amount: int           # premio en unidades menores (céntimos)

    def as_dict(self) -> dict:
        return {
            "kind": "WAY",
            "symbol": self.symbol,
            "count": self.count,
            "ways": self.ways,
            "multiplier": str(self.multiplier),
            "amount": self.amount,
        }


@dataclass(frozen=True)
class SpinOutcome:
    matrix: list[list[str]]     # filas x columnas (matrix[row][col])
    line_wins: list[LineWin]
    base_win: int               # suma de premios (líneas o ways) en céntimos
    jackpot_win: int            # premio del drop jackpot (0 si no dispara)
    total_win: int              # base_win + jackpot_win
    bet_amount: int
    bet_per_line: int           # 0 en modo WAYS
    stops: list[int]            # parada por rodillo (reproducibilidad / prueba)
    jackpot_triggered: bool
    way_wins: list[WaysWin] = field(default_factory=list)
    # Free spins (tiradas gratis): scatters presentes en la matriz y si disparan.
    scatter_count: int = 0
    free_spins_triggered: bool = False
    free_spins_awarded: int = 0
    win_multiplier: int = 1     # multiplicador aplicado a los premios de este tiro

    def winning_lines_json(self) -> list[dict]:
        """Representación JSON-serializable para Spin.winning_lines / auditoría."""
        data = [lw.as_dict() for lw in self.line_wins]
        data += [w.as_dict() for w in self.way_wins]
        if self.jackpot_triggered:
            data.append({"type": "DROP_JACKPOT", "amount": self.jackpot_win})
        if self.free_spins_triggered:
            data.append({"type": "FREE_SPINS", "scatters": self.scatter_count, "awarded": self.free_spins_awarded})
        return data


@dataclass(frozen=True)
class JackpotSpec:
    """Configuración del Drop Jackpot pasada al motor."""
    is_active: bool
    probability: Decimal        # prob. de disparo por tiro PAGADO (ej: 0.0001)
    award_amount: int           # premio fijo en unidades menores (MVP)


@dataclass(frozen=True)
class FreeSpinsSpec:
    """Configuración de tiradas gratis pasada al motor."""
    is_active: bool
    scatter_symbols: frozenset  # símbolos que cuentan como scatter
    trigger_count: int          # nº de scatters para disparar la ronda
    spins_awarded: int          # tiros gratis otorgados por disparo
    multiplier: int             # multiplicador de premios durante la ronda
    retrigger: bool             # si juntar scatters durante la ronda añade más tiros


# --------------------------------------------------------------------------- #
# Motor
# --------------------------------------------------------------------------- #
class SlotEngine:
    def __init__(
        self,
        *,
        reels: Sequence[Sequence[str]],
        rows: int,
        cols: int,
        paytable: dict[tuple[str, int], Decimal],
        paylines: Optional[Sequence[Sequence[int]]] = None,
        win_mode: str = LINES,
        wild_symbols: Optional[set[str]] = None,
        jackpot: Optional[JackpotSpec] = None,
        free_spins: Optional[FreeSpinsSpec] = None,
        ways_divisor: Optional[int] = None,
        rng: Optional[random.Random] = None,
    ):
        if win_mode not in (LINES, WAYS):
            raise ValueError(f"win_mode inválido: {win_mode!r}.")
        if len(reels) != cols:
            raise ValueError(f"Se esperan {cols} bandas (una por rodillo), llegaron {len(reels)}.")
        for i, strip in enumerate(reels):
            if len(strip) < rows:
                raise ValueError(f"La banda del rodillo {i} es más corta que las filas visibles.")

        paylines = list(paylines or [])
        if win_mode == LINES:
            if not paylines:
                raise ValueError("Modo LINES: se requiere al menos una línea de pago.")
            for i, pattern in enumerate(paylines):
                if len(pattern) != cols:
                    raise ValueError(f"La línea {i} debe tener {cols} entradas (una por rodillo).")

        self.reels = [list(s) for s in reels]
        self.rows = rows
        self.cols = cols
        self.win_mode = win_mode
        self.paylines = [list(p) for p in paylines]
        self.paytable = dict(paytable)
        self.wild_symbols = set(wild_symbols or ())
        self.jackpot = jackpot
        self.free_spins = free_spins
        # Normalizador de apuesta para WAYS (no afecta al RTP; lo calibra la paytable).
        self.ways_divisor = ways_divisor if ways_divisor is not None else rows ** cols
        # CSPRNG por defecto; inyectable para tests deterministas.
        self.rng = rng if rng is not None else secrets.SystemRandom()

    # -- Generación de la matriz ------------------------------------------- #
    def _spin_columns(self) -> tuple[list[list[str]], list[int]]:
        """Gira cada rodillo: elige una parada y lee la ventana visible (con wrap)."""
        columns: list[list[str]] = []
        stops: list[int] = []
        for c in range(self.cols):
            strip = self.reels[c]
            stop = self.rng.randrange(len(strip))
            stops.append(stop)
            window = [strip[(stop + r) % len(strip)] for r in range(self.rows)]
            columns.append(window)
        return columns, stops

    @staticmethod
    def _to_matrix(columns: list[list[str]], rows: int, cols: int) -> list[list[str]]:
        """Transpone columnas (rodillos) a filas x columnas para render/auditoría."""
        return [[columns[c][r] for c in range(cols)] for r in range(rows)]

    # -- Búsqueda de pago (con relleno de huecos) -------------------------- #
    def _paytable_lookup(self, symbol: str, count: int) -> Optional[Decimal]:
        """
        Multiplicador de `symbol` para `count` coincidencias. Si no hay entrada EXACTA,
        usa la del MAYOR tramo definido que no supere `count` (así un 4 paga como 3 si
        solo tienes 3 y 5 definidos). Devuelve None si no hay ningún tramo <= count
        (p. ej. una racha de 2 cuando el pago mínimo es 3). Evita que un hueco en la
        tabla mate silenciosamente un premio.
        """
        exact = self.paytable.get((symbol, count))
        if exact is not None:
            return exact
        best_k, best = -1, None
        for (sym, k), mult in self.paytable.items():
            if sym == symbol and k <= count and k > best_k:
                best_k, best = k, mult
        return best

    # -- Evaluación de una línea ------------------------------------------- #
    def _evaluate_line(
        self, matrix: list[list[str]], pattern: Sequence[int], line_index: int, bet_per_line: int
    ) -> Optional[LineWin]:
        symbols = [matrix[pattern[c]][c] for c in range(self.cols)]

        # El símbolo pagador es el primer NO-wild; si todo es wild, el propio wild.
        base = next((s for s in symbols if s not in self.wild_symbols), symbols[0])

        # Cuenta coincidencias consecutivas desde la izquierda (wild sustituye).
        count = 0
        for s in symbols:
            if s == base or s in self.wild_symbols:
                count += 1
            else:
                break

        multiplier = self._paytable_lookup(base, count)
        if multiplier is None:
            return None

        amount = int(Decimal(multiplier) * bet_per_line)  # trunca (favor casa)
        if amount <= 0:
            return None
        return LineWin(line_index, base, count, Decimal(multiplier), amount)

    # -- Evaluación de ways ------------------------------------------------ #
    def _evaluate_ways(self, columns: list[list[str]], bet_amount: int) -> list[WaysWin]:
        """
        'Ways to win': mismo símbolo en rodillos CONSECUTIVOS desde el rodillo 0
        (izquierda), en cualquier fila. El nº de formas es el producto de las
        apariciones del símbolo en cada rodillo contribuyente. El wild sustituye.

        Convención de pago (no afecta al RTP, que se calibra con bandas+paytable):
            premio = multiplier * ways * bet_amount / ways_divisor
        con ways_divisor = filas**rodillos por defecto (243 en 5x3), de modo que
        una pantalla completa de un símbolo paga ~ multiplier * apuesta.
        """
        wins: list[WaysWin] = []
        candidate_symbols = {symbol for (symbol, _count) in self.paytable}

        for symbol in sorted(candidate_symbols):
            symbol_is_wild = symbol in self.wild_symbols
            ways = 1
            reels_hit = 0
            has_real_symbol = False

            for r in range(self.cols):
                col = columns[r]
                n_symbol = sum(1 for s in col if s == symbol)
                n_wild = 0 if symbol_is_wild else sum(1 for s in col if s in self.wild_symbols)
                effective = n_symbol + n_wild
                if effective == 0:
                    break
                if n_symbol > 0:
                    has_real_symbol = True
                ways *= effective
                reels_hit += 1

            if reels_hit == 0:
                continue
            # Anti-doble-conteo: un símbolo no-wild solo paga si aparece de verdad
            # en la racha (evita que una pantalla de wilds cobre por cada símbolo).
            if not symbol_is_wild and not has_real_symbol:
                continue

            multiplier = self._paytable_lookup(symbol, reels_hit)
            if multiplier is None:
                continue

            # Redondeo al céntimo (HALF_UP): permite apuestas pequeñas sin que los
            # premios se trunquen a 0 y sin sesgar el RTP.
            raw = Decimal(multiplier) * ways * Decimal(bet_amount) / Decimal(self.ways_divisor)
            amount = int(raw.quantize(Decimal(1), rounding=ROUND_HALF_UP))
            if amount <= 0:
                continue
            wins.append(
                WaysWin(
                    symbol=symbol, count=reels_hit, ways=ways,
                    multiplier=Decimal(multiplier), amount=amount,
                )
            )
        return wins

    # -- Drop Jackpot ------------------------------------------------------ #
    def _roll_jackpot(self) -> bool:
        if self.jackpot is None or not self.jackpot.is_active:
            return False
        return self.rng.random() < float(self.jackpot.probability)

    # -- Free spins -------------------------------------------------------- #
    def _count_scatters(self, matrix: list[list[str]]) -> int:
        """Nº de símbolos scatter en TODA la matriz (posición libre)."""
        if not self.free_spins or not self.free_spins.is_active:
            return 0
        scatters = self.free_spins.scatter_symbols
        return sum(1 for row in matrix for s in row if s in scatters)

    # -- RTP analítico (solo LINES) ---------------------------------------- #
    def analytic_line_rtp(self) -> float:
        """
        RTP EXACTO (sin muestreo) del juego base en modo LINES, calculado a partir de
        las frecuencias de cada banda. Es posible porque los rodillos son
        independientes y la parada es uniforme: la probabilidad de cada símbolo en la
        posición de una línea es (apariciones en la banda / largo de la banda), IGUAL
        para cualquier fila. El RTP por línea es idéntico para todas las líneas, así
        que el RTP del juego = EV de una línea (en múltiplos de la apuesta por línea).

        Ignora el truncado a céntimos y el drop jackpot (sesgo despreciable y a favor
        de la casa). Se usa para CUADRAR el RTP sin la varianza del Monte Carlo. Para
        WAYS devuelve None (no aplica esta fórmula cerrada).
        """
        if self.win_mode != LINES:
            return None
        from collections import Counter

        freq: list[dict] = []
        wild_p: list[float] = []
        for c in range(self.cols):
            strip = self.reels[c]
            length = len(strip)
            cnt = Counter(strip)
            freq.append({s: n / length for s, n in cnt.items()})
            wild_p.append(sum(n / length for s, n in cnt.items() if s in self.wild_symbols))

        payable = {sym for (sym, _k) in self.paytable if sym not in self.wild_symbols}
        ev = 0.0
        for base in payable:
            b = [freq[c].get(base, 0.0) for c in range(self.cols)]
            m = [b[c] + wild_p[c] for c in range(self.cols)]  # prob "casa": base o wild
            pref_m = 1.0  # prod de m en las primeras k columnas
            pref_w = 1.0  # prod de wild en las primeras k columnas
            for k in range(1, self.cols + 1):
                pref_m *= m[k - 1]
                pref_w *= wild_p[k - 1]
                # P(racha de k con AL MENOS un símbolo base real) = todas casan - todas wild.
                at_least_one_base = pref_m - pref_w
                if at_least_one_base <= 0:
                    continue
                # count == k exacto: la columna k rompe (ni base ni wild); salvo k == cols.
                prob = at_least_one_base * ((1.0 - m[k]) if k < self.cols else 1.0)
                mult = self._paytable_lookup(base, k)
                if mult is not None and prob > 0:
                    ev += float(mult) * prob

        # Línea de SOLO wilds: base = el propio wild, count = cols (cola de varianza).
        for wsym in self.wild_symbols:
            mult = self._paytable_lookup(wsym, self.cols)
            if mult is None:
                continue
            prob_all = 1.0
            for c in range(self.cols):
                prob_all *= freq[c].get(wsym, 0.0)
            if prob_all > 0:
                ev += float(mult) * prob_all
        return ev

    # -- API pública ------------------------------------------------------- #
    def spin(self, bet_amount: int, win_multiplier: int = 1) -> SpinOutcome:
        """
        Un tiro. `win_multiplier` multiplica los premios (se usa durante una ronda de
        tiradas gratis; en juego base es 1). No afecta a la apuesta ni al jackpot.
        """
        if bet_amount <= 0:
            raise ValueError("bet_amount debe ser > 0.")
        if win_multiplier < 1:
            raise ValueError("win_multiplier debe ser >= 1.")

        columns, stops = self._spin_columns()
        matrix = self._to_matrix(columns, self.rows, self.cols)

        line_wins: list[LineWin] = []
        way_wins: list[WaysWin] = []
        bet_per_line = 0

        if self.win_mode == WAYS:
            way_wins = self._evaluate_ways(columns, bet_amount)
            base_win = sum(w.amount for w in way_wins)
        else:
            num_lines = len(self.paylines)
            bet_per_line = bet_amount // num_lines
            if bet_per_line <= 0:
                raise ValueError(
                    f"bet_amount ({bet_amount}) es menor que el nº de líneas ({num_lines})."
                )
            for i, pattern in enumerate(self.paylines):
                lw = self._evaluate_line(matrix, pattern, i, bet_per_line)
                if lw is not None:
                    line_wins.append(lw)
            base_win = sum(lw.amount for lw in line_wins)

        # Multiplicador de la ronda de tiradas gratis (x1 en juego base).
        if win_multiplier > 1:
            base_win *= win_multiplier

        # Free spins: se disparan por scatters (independiente de que haya premio).
        scatter_count = self._count_scatters(matrix)
        fs_triggered = bool(
            self.free_spins and self.free_spins.is_active
            and scatter_count >= self.free_spins.trigger_count
        )
        fs_awarded = self.free_spins.spins_awarded if fs_triggered else 0

        # Drop Jackpot: SOLO se evalúa en un tiro ya pagado (base_win > 0).
        jackpot_triggered = False
        jackpot_win = 0
        if base_win > 0 and self._roll_jackpot():
            jackpot_triggered = True
            jackpot_win = self.jackpot.award_amount

        total_win = base_win + jackpot_win
        return SpinOutcome(
            matrix=matrix,
            line_wins=line_wins,
            base_win=base_win,
            jackpot_win=jackpot_win,
            total_win=total_win,
            bet_amount=bet_amount,
            bet_per_line=bet_per_line,
            stops=stops,
            jackpot_triggered=jackpot_triggered,
            way_wins=way_wins,
            scatter_count=scatter_count,
            free_spins_triggered=fs_triggered,
            free_spins_awarded=fs_awarded,
            win_multiplier=win_multiplier,
        )


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def default_3x3_paylines() -> list[list[int]]:
    """5 líneas clásicas para 3x3: 3 horizontales + 2 diagonales."""
    return [
        [0, 0, 0],  # fila superior
        [1, 1, 1],  # fila central
        [2, 2, 2],  # fila inferior
        [0, 1, 2],  # diagonal ↘
        [2, 1, 0],  # diagonal ↗
    ]


def default_paylines(cols: int, rows: int) -> list[list[int]]:
    """
    Líneas por defecto para una rejilla arbitraria: una por cada fila horizontal
    más dos diagonales en zig-zag (que se ajustan si cols != rows). Sin duplicados.
    """
    lines: list[list[int]] = [[r] * cols for r in range(rows)]
    if rows >= 2:
        down = [min(c, rows - 1) for c in range(cols)]
        up = [max(rows - 1 - c, 0) for c in range(cols)]
        for diag in (down, up):
            if diag not in lines:
                lines.append(diag)
    return lines


def simulate_rtp(engine: SlotEngine, bet_amount: int, spins: int) -> dict:
    """
    Monte Carlo: corre `spins` tiros y mide el RTP EMPÍRICO de la configuración.
    Sirve para VERIFICAR que las bandas dan el target (offline / QA / certificación),
    NUNCA como lazo de ajuste en producción.
    """
    total_bet = 0
    total_win = 0
    total_base = 0
    total_jackpot = 0
    hits = 0
    fs = engine.free_spins
    for _ in range(spins):
        out = engine.spin(bet_amount)
        total_bet += bet_amount  # solo la tirada PAGADA cuenta como apuesta
        total_win += out.total_win
        total_base += out.base_win
        total_jackpot += out.jackpot_win
        if out.total_win > 0:
            hits += 1

        # Ronda de tiradas gratis: cuentan sus premios pero NO su apuesta (bet 0).
        # Esto hace que el RTP medido INCLUYA la contribución del feature (verdad).
        if out.free_spins_triggered and fs and fs.is_active:
            remaining = out.free_spins_awarded
            guard = 0  # tope de seguridad contra retriggers infinitos
            while remaining > 0 and guard < 100_000:
                guard += 1
                remaining -= 1
                fspin = engine.spin(bet_amount, win_multiplier=fs.multiplier)
                total_win += fspin.total_win
                total_base += fspin.base_win
                total_jackpot += fspin.jackpot_win
                if fs.retrigger and fspin.free_spins_triggered:
                    remaining += fs.spins_awarded
    return {
        "spins": spins,
        "rtp": (total_win / total_bet) if total_bet else 0.0,
        "rtp_base": (total_base / total_bet) if total_bet else 0.0,
        "rtp_jackpot": (total_jackpot / total_bet) if total_bet else 0.0,
        "hit_rate": (hits / spins) if spins else 0.0,
    }
