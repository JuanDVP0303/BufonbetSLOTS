import { apiFetch, apiUpload } from "./client";

export interface PlayerRow {
  id: number;
  email: string;
  balance: number;
  currency: string;
  total_bet: number;
  total_win: number;
  spins: number;
  date_joined: string;
}

export interface AuditRow {
  sequence_number: number;
  external_player_id: string;
  bet_amount: number;
  win_amount: number;
  currency: string;
  math_version: string;
  recorded_at: string;
}

export interface GameRow {
  slug: string;
  name: string;
  title: string;
  win_mode: string;
  grid: { cols: number; rows: number };
  is_active: boolean;
  background_color: string;
  accent_color: string;
  background_type: string;
  background_gradient: string;
  thumbnail: string | null;
  symbols: number;
  assets: number;
  symbol_codes: string[];
  /** RTP objetivo activo (fracción como string, ej. "0.9500") o null. */
  target_rtp: string | null;
  /** Imagen ACTUAL de cada símbolo (code -> url) para previsualizar en el editor. */
  symbol_assets: Record<string, string | null>;
  /** URL ACTUAL de cada asset del juego (campo -> url) para previsualizar. */
  asset_urls: Record<string, string | null>;
}

export interface CurrencyInfo {
  code: string;
  name: string;
  exponent: number;
  symbol: string;
}

export interface SymbolSpec {
  code: string;
  name: string;
  is_wild: boolean;
  is_scatter: boolean;
  weight: number;
}
export interface PayoutSpec {
  code: string;
  count: number;
  multiplier: string;
}
export interface BetProfileSpec {
  currency: string;
  min_bet: number;
  max_bet: number;
  default_bet: number;
  bet_levels: number[];
}
export interface GameBuildSpec {
  name: string;
  slug: string;
  title: string;
  grid_cols: number;
  grid_rows: number;
  win_mode: "LINES" | "WAYS";
  volatility: "LOW" | "MEDIUM" | "HIGH";
  max_win_multiplier: number;
  background_color: string;
  accent_color: string;
  background_type: "COLOR" | "GRADIENT" | "IMAGE" | "VIDEO";
  background_gradient: string;
  target_rtp: string;
  symbols: SymbolSpec[];
  payouts: PayoutSpec[];
  paylines: number[][];
  bet_profiles: BetProfileSpec[];
  free_spins?: FreeSpinsSpec;
}

export interface FreeSpinsSpec {
  is_active: boolean;
  trigger_scatter_count: number;
  spins_awarded: number;
  multiplier: number;
  retrigger: boolean;
}

export interface SimResult {
  spins: number;
  rtp: number;
  rtp_base: number;
  rtp_jackpot: number;
  hit_rate: number;
  target_rtp: number;
  bet_amount: number;
  deviation: number;
}

/** Sobre de paginación que devuelven las listas del backend. */
export interface Paginated<T> {
  results: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

const qs = (page: number, pageSize: number) => `?page=${page}&page_size=${pageSize}`;

export const listPlayers = (token: string, page = 1, pageSize = 25) =>
  apiFetch<Paginated<PlayerRow>>(`/master/players/${qs(page, pageSize)}`, { token });

export const listAudit = (
  token: string, page = 1, pageSize = 25, from?: string, to?: string
) => {
  const extra = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  return apiFetch<Paginated<AuditRow>>(`/master/audit/${qs(page, pageSize)}${extra}`, { token });
};

export interface FreeRoundGrantRow {
  id: string;
  game: string;
  game_title: string;
  currency: string;
  player: string;
  operator: string | null;
  bet_amount: number;
  total: number;
  remaining: number;
  win_multiplier: number;
  status: string;
  expires_at: string | null;
  note: string;
  created_at: string;
}

export interface GrantFreeRoundsBody {
  game: string;
  currency: string;
  quantity: number;
  operator_code?: string;
  external_player_id?: string;
  player_email?: string;
  bet_amount?: number | null;
  win_multiplier?: number;
  expires_at?: string | null;
  note?: string;
}

export const grantFreeRounds = (token: string, body: GrantFreeRoundsBody) =>
  apiFetch<FreeRoundGrantRow>("/master/free-rounds/", { method: "POST", body, token });

export const listFreeRounds = (token: string, page = 1, pageSize = 25, operator?: string) =>
  apiFetch<Paginated<FreeRoundGrantRow>>(
    `/master/free-rounds/${qs(page, pageSize)}${operator ? `&operator=${operator}` : ""}`,
    { token }
  );

export const creditPlayer = (token: string, userId: number, amount: number, reference: string) =>
  apiFetch<{ id: number; email: string; balance_after: number }>(
    `/master/players/${userId}/credit/`,
    { method: "POST", body: { amount, reference }, token }
  );

export const listGames = (token: string) => apiFetch<GameRow[]>("/master/games/", { token });

export const createGame = (
  token: string,
  body: { name: string; slug: string; title: string }
) => apiFetch<GameRow>("/master/games/", { method: "POST", body, token });

export function uploadSymbolAsset(token: string, slug: string, code: string, file: File) {
  const fd = new FormData();
  fd.append("image", file);
  return apiUpload<{ code: string; image_url: string }>(
    `/master/games/${slug}/symbols/${code}/asset/`,
    fd,
    token
  );
}

export const listCurrencies = (token: string) =>
  apiFetch<CurrencyInfo[]>("/currencies/", { token });

export const buildGame = (token: string, spec: GameBuildSpec) =>
  apiFetch<GameRow>("/master/games/build/", { method: "POST", body: spec, token });

export const simulateGame = (token: string, slug: string, spins: number, betAmount?: number) =>
  apiFetch<SimResult>(`/master/games/${slug}/simulate/`, {
    method: "POST",
    body: { spins, bet_amount: betAmount ?? null },
    token,
  });

export interface GameThemePatch {
  title?: string;
  background_color?: string;
  accent_color?: string;
  background_type?: string;
  background_gradient?: string;
  /** RTP objetivo (fracción, ej. "0.95"). Si viene, el backend re-calibra la paytable. */
  target_rtp?: string;
  /** Tamaño de rejilla. Si cambia, regenera bandas/líneas y recalibra. */
  grid_cols?: number;
  grid_rows?: number;
}

export const updateGameTheme = (token: string, slug: string, body: GameThemePatch) =>
  apiFetch<GameRow>(`/master/games/${slug}/theme/`, { method: "PATCH", body, token });

export const deleteGame = (token: string, slug: string) =>
  apiFetch<null>(`/master/games/${slug}/`, { method: "DELETE", token });

export function uploadGameAsset(token: string, slug: string, field: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return apiUpload<{ field: string; url: string }>(
    `/master/games/${slug}/asset/${field}/`,
    fd,
    token
  );
}
