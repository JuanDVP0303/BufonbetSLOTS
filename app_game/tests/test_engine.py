"""
Tests unitarios del motor (PUROS, sin BD).

Punto central pedido: verificar que la matriz generada corresponde con los premios
devueltos. `test_matrix_matches_prizes` recalcula el premio de forma independiente al
motor sobre miles de tiros y exige igualdad exacta.

Se inyecta random.Random(seed) para resultados deterministas.
"""
import random
from decimal import Decimal

import pytest

from app_game.engine import (
    WAYS,
    JackpotSpec,
    SlotEngine,
    WaysWin,
    default_3x3_paylines,
    simulate_rtp,
)


def make_engine(reels, paytable, *, paylines=None, wilds=None, jackpot=None, seed=0):
    return SlotEngine(
        reels=reels,
        rows=3,
        cols=3,
        paylines=paylines or default_3x3_paylines(),
        paytable=paytable,
        wild_symbols=wilds,
        jackpot=jackpot,
        rng=random.Random(seed),
    )


def test_matrix_dimensions():
    eng = make_engine([["A", "B", "C", "D"]] * 3, {("A", 3): Decimal("5")})
    out = eng.spin(100)
    assert len(out.matrix) == 3
    assert all(len(row) == 3 for row in out.matrix)


def test_determinism_same_seed():
    reels = [["A", "B", "C", "D"]] * 3
    paytable = {("A", 3): Decimal("5")}
    a = make_engine(reels, paytable, seed=42).spin(100)
    b = make_engine(reels, paytable, seed=42).spin(100)
    assert a.matrix == b.matrix
    assert a.total_win == b.total_win


def test_known_full_line_win():
    # Todas las celdas son A -> las 5 líneas pagan.
    eng = make_engine([["A", "A", "A"]] * 3, {("A", 3): Decimal("10")})
    out = eng.spin(100)  # 5 líneas -> bet_per_line = 20
    assert out.bet_per_line == 20
    assert len(out.line_wins) == 5
    assert all(lw.amount == 200 for lw in out.line_wins)  # 10 * 20
    assert out.base_win == 1000


def test_wild_substitution():
    # Ventana visible constante [A, WILD, A]; línea central cuenta como 3 A.
    reels = [["A", "A", "A"], ["WILD", "WILD", "WILD"], ["A", "A", "A"]]
    eng = make_engine(
        reels, {("A", 3): Decimal("10")}, paylines=[[1, 1, 1]], wilds={"WILD"}
    )
    out = eng.spin(100)  # 1 línea -> bet_per_line = 100
    assert len(out.line_wins) == 1
    lw = out.line_wins[0]
    assert lw.symbol == "A"
    assert lw.count == 3
    assert lw.amount == 1000


def test_no_combination_pays_zero():
    reels = [["A", "A", "A"], ["B", "B", "B"], ["C", "C", "C"]]
    eng = make_engine(reels, {("A", 3): Decimal("10")}, seed=5)
    out = eng.spin(100)
    assert out.total_win == 0
    assert out.line_wins == []


def test_matrix_matches_prizes():
    """La matriz devuelta debe justificar EXACTAMENTE el premio calculado."""
    reels = [["A", "B", "C", "D", "WILD"]] * 3
    paytable = {("A", 3): Decimal("50"), ("B", 3): Decimal("20"), ("C", 3): Decimal("5")}
    wilds = {"WILD"}
    eng = make_engine(reels, paytable, wilds=wilds, seed=2024)

    for _ in range(5000):
        out = eng.spin(100)
        expected = 0
        for pattern in default_3x3_paylines():
            syms = [out.matrix[pattern[c]][c] for c in range(3)]
            base = next((s for s in syms if s not in wilds), syms[0])
            cnt = 0
            for s in syms:
                if s == base or s in wilds:
                    cnt += 1
                else:
                    break
            mult = paytable.get((base, cnt))
            if mult is not None:
                expected += int(mult * out.bet_per_line)
        assert out.base_win == expected, (out.matrix, out.base_win, expected)


def test_jackpot_only_on_paid_spin():
    paytable = {("A", 3): Decimal("10")}
    jp = JackpotSpec(is_active=True, probability=Decimal("1.0"), award_amount=99999)

    paid = make_engine([["A", "A", "A"]] * 3, paytable, jackpot=jp, seed=7).spin(100)
    assert paid.jackpot_triggered
    assert paid.jackpot_win == 99999
    assert paid.total_win == paid.base_win + 99999

    reels = [["A", "A", "A"], ["B", "B", "B"], ["C", "C", "C"]]
    unpaid = make_engine(reels, paytable, jackpot=jp, seed=7).spin(100)
    assert not unpaid.jackpot_triggered
    assert unpaid.total_win == 0


def test_bet_below_lines_raises():
    eng = make_engine([["A", "B", "C"]] * 3, {("A", 3): Decimal("5")})
    with pytest.raises(ValueError):
        eng.spin(3)  # 3 < 5 líneas -> bet_per_line 0


def test_total_win_is_base_plus_jackpot():
    paytable = {("A", 3): Decimal("2")}
    jp = JackpotSpec(is_active=True, probability=Decimal("1.0"), award_amount=500)
    out = make_engine([["A", "A", "A"]] * 3, paytable, jackpot=jp, seed=1).spin(100)
    assert out.total_win == out.base_win + out.jackpot_win


# --------------------------------------------------------------------------- #
# El motor es agnóstico al tamaño: estos tests lo prueban en 5x3 (modo LINES).
# --------------------------------------------------------------------------- #
def make_engine_5x3(reels, paytable, *, paylines=None, wilds=None, seed=0):
    return SlotEngine(
        reels=reels,
        rows=3,
        cols=5,
        paylines=paylines or [[1, 1, 1, 1, 1]],  # línea central de 5 rodillos
        paytable=paytable,
        wild_symbols=wilds,
        rng=random.Random(seed),
    )


PAYTABLE_5 = {("A", 3): Decimal("5"), ("A", 4): Decimal("20"), ("A", 5): Decimal("100")}


def test_5x3_dimensions():
    out = make_engine_5x3([["A", "B", "C"]] * 5, PAYTABLE_5).spin(100)
    assert len(out.matrix) == 3
    assert all(len(row) == 5 for row in out.matrix)


def test_5x3_five_of_a_kind():
    out = make_engine_5x3([["A", "A", "A"]] * 5, PAYTABLE_5).spin(100)
    lw = out.line_wins[0]
    assert lw.count == 5
    assert lw.amount == 100 * 100  # multiplier 100 * bet_per_line 100


def test_5x3_partial_run_stops_at_mismatch():
    reels = [["A", "A", "A"], ["A", "A", "A"], ["A", "A", "A"],
             ["B", "B", "B"], ["B", "B", "B"]]  # central A,A,A,B,B
    lw = make_engine_5x3(reels, PAYTABLE_5).spin(100).line_wins[0]
    assert lw.count == 3
    assert lw.amount == 5 * 100


def test_5x3_wild_extends_run():
    reels = [["A", "A", "A"], ["A", "A", "A"], ["WILD", "WILD", "WILD"],
             ["A", "A", "A"], ["B", "B", "B"]]  # central A,A,WILD,A,B
    lw = make_engine_5x3(reels, PAYTABLE_5, wilds={"WILD"}).spin(100).line_wins[0]
    assert lw.symbol == "A"
    assert lw.count == 4
    assert lw.amount == 20 * 100


def test_5x3_matrix_matches_prizes():
    reels = [["A", "B", "C", "D", "WILD"]] * 5
    eng = make_engine_5x3(reels, PAYTABLE_5, wilds={"WILD"}, seed=7)
    for _ in range(3000):
        out = eng.spin(100)
        syms = [out.matrix[1][c] for c in range(5)]
        base = next((s for s in syms if s != "WILD"), syms[0])
        cnt = 0
        for s in syms:
            if s == base or s == "WILD":
                cnt += 1
            else:
                break
        mult = PAYTABLE_5.get((base, cnt))
        expected = int(mult * out.bet_per_line) if mult else 0
        assert out.base_win == expected, (out.matrix, out.base_win, expected)


# --------------------------------------------------------------------------- #
# Modo WAYS (5x3 = 243 formas). El nº de formas = producto de apariciones por
# rodillo en rodillos consecutivos desde la izquierda.
# --------------------------------------------------------------------------- #
def make_ways_engine(reels, paytable, *, rows=3, cols=5, wilds=None, seed=0):
    return SlotEngine(
        reels=reels,
        rows=rows,
        cols=cols,
        paytable=paytable,
        win_mode=WAYS,
        wild_symbols=wilds,
        rng=random.Random(seed),
    )


def _recompute_ways_base(matrix, paytable, wilds, rows, cols, ways_divisor, bet_amount):
    """Recalcula el premio WAYS de forma independiente al motor, desde la matriz."""
    columns = [[matrix[r][c] for r in range(rows)] for c in range(cols)]
    total = 0
    wild_set = wilds or set()
    for symbol in {s for (s, _c) in paytable}:
        symbol_is_wild = symbol in wild_set
        ways, k, has_real = 1, 0, False
        for c in range(cols):
            n_symbol = sum(1 for s in columns[c] if s == symbol)
            n_wild = 0 if symbol_is_wild else sum(1 for s in columns[c] if s in wild_set)
            eff = n_symbol + n_wild
            if eff == 0:
                break
            has_real = has_real or n_symbol > 0
            ways *= eff
            k += 1
        if k == 0 or (not symbol_is_wild and not has_real):
            continue
        mult = paytable.get((symbol, k))
        if mult is None:
            continue
        from decimal import ROUND_HALF_UP
        from decimal import Decimal as D
        raw = D(mult) * ways * D(bet_amount) / D(ways_divisor)
        total += int(raw.quantize(D(1), rounding=ROUND_HALF_UP))
    return total


def test_ways_mode_allows_empty_paylines():
    eng = make_ways_engine([["A", "B", "C"]] * 5, {("A", 3): Decimal("2")})
    assert eng.win_mode == WAYS
    assert eng.ways_divisor == 3 ** 5  # 243


def test_ways_full_screen_pays_multiplier_times_bet():
    # Los 5 rodillos muestran 3 A: ways = 3^5 = 243, count = 5.
    eng = make_ways_engine([["A", "A", "A"]] * 5, {("A", 5): Decimal("100")})
    out = eng.spin(100)  # amount = 100 * 243 * 100 / 243 = 100 * 100
    assert len(out.way_wins) == 1
    w = out.way_wins[0]
    assert w.symbol == "A"
    assert w.count == 5
    assert w.ways == 243
    assert w.amount == 100 * 100


def test_ways_counts_product_of_occurrences():
    # Bandas de longitud 3 => la ventana visible ES toda la banda (independiente
    # de la parada). Rodillo0: {A,A,B}=2A ; r1: {A,B,B}=1A ; r2: {A,A,A}=3A ; r3: 0A.
    reels = [
        ["A", "A", "B"],  # 2 A
        ["A", "B", "B"],  # 1 A
        ["A", "A", "A"],  # 3 A
        ["B", "B", "B"],  # 0 A -> corta
        ["B", "B", "B"],
    ]
    out = make_ways_engine(reels, {("A", 3): Decimal("10")}).spin(100)
    assert len(out.way_wins) == 1
    w = out.way_wins[0]
    assert w.count == 3
    assert w.ways == 2 * 1 * 3  # = 6


def test_ways_wild_extends_and_multiplies():
    # r0:3A r1:3WILD r2:3A r3:B(corta) -> count 3, ways 3*3*3 = 27
    reels = [
        ["A", "A", "A"],
        ["WILD", "WILD", "WILD"],
        ["A", "A", "A"],
        ["B", "B", "B"],
        ["B", "B", "B"],
    ]
    out = make_ways_engine(reels, {("A", 3): Decimal("5")}, wilds={"WILD"}).spin(100)
    assert len(out.way_wins) == 1
    w = out.way_wins[0]
    assert w.symbol == "A"
    assert w.count == 3
    assert w.ways == 27


def test_ways_no_win_when_reel0_missing_symbol():
    reels = [["B", "B", "B"], ["A", "A", "A"], ["A", "A", "A"], ["A", "A", "A"], ["A", "A", "A"]]
    out = make_ways_engine(reels, {("A", 3): Decimal("5"), ("A", 4): Decimal("20")}).spin(100)
    assert out.base_win == 0
    assert out.way_wins == []


def test_ways_matrix_matches_prizes():
    reels = [["A", "B", "C", "WILD"]] * 5
    paytable = {("A", 3): Decimal("5"), ("A", 4): Decimal("20"), ("A", 5): Decimal("100"),
                ("B", 3): Decimal("3"), ("B", 4): Decimal("10"), ("B", 5): Decimal("40")}
    wilds = {"WILD"}
    eng = make_ways_engine(reels, paytable, wilds=wilds, seed=2024)
    for _ in range(3000):
        out = eng.spin(200)
        expected = _recompute_ways_base(
            out.matrix, paytable, wilds, rows=3, cols=5,
            ways_divisor=eng.ways_divisor, bet_amount=200,
        )
        assert out.base_win == expected, (out.matrix, out.base_win, expected)


@pytest.mark.slow
def test_simulate_rtp_runs_and_is_bounded():
    reels = [["A", "B", "C", "D", "E"]] * 3
    eng = make_engine(reels, {("A", 3): Decimal("25")}, seed=99)
    res = simulate_rtp(eng, 100, 50_000)
    assert res["spins"] == 50_000
    assert 0.0 <= res["rtp"] < 5.0
    assert 0.0 <= res["hit_rate"] <= 1.0
