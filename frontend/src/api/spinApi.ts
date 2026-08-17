// Cliente de la API de spin del backend Django.

export interface WinLine {
  kind: "LINE" | "WAY";
  symbol: string;
  count: number;
  amount: number;
  line_index?: number;
  ways?: number;
  multiplier: string;
}

export interface SpinResponse {
  spin_id: string;
  matrix: string[][]; // filas x columnas
  base_win: number;
  jackpot_win: number;
  total_win: number;
  jackpot_triggered: boolean;
  winning_lines: WinLine[];
  currency: string;
  balance?: number; // presente en el modo jugador interno (/play/spin)
  // Tiradas gratis
  scatter_count?: number;
  free_spins_triggered?: boolean;
  free_spins_awarded?: number;
  win_multiplier?: number;
  in_free_spins?: boolean;
  free_spins_remaining?: number;
}

export class SpinError extends Error {}

export async function requestSpin(params: {
  apiBase: string;
  gameSession: string;
  betAmount: number;
}): Promise<SpinResponse> {
  const { apiBase, gameSession, betAmount } = params;
  const res = await fetch(`${apiBase}/api/v1/spin/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      game_session: gameSession,
      bet_amount: betAmount,
      // Clave de idempotencia por intento: evita débitos duplicados si se reintenta.
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* respuesta no-JSON */
    }
    throw new SpinError(detail);
  }
  return res.json();
}
