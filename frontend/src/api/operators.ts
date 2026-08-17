import { apiFetch } from "./client";

export interface OperatorRow {
  code: string;
  name: string;
  is_active: boolean;
  games: number;
  keys: number;
  players: number;
  wallet_mode: string;
  wallet_base_url: string;
  created_at: string;
}

export interface ApiKeyRow {
  prefix: string;
  label: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

/** Solo en la respuesta de creación: el secreto se ve UNA vez. */
export interface NewApiKey {
  api_key: string;
  prefix: string;
  label: string;
}

export interface OperatorGameRow {
  slug: string;
  title: string;
  grid: { cols: number; rows: number };
  win_mode: string;
  assigned: boolean;
  is_enabled: boolean;
}

export interface CurrencyTotals {
  currency: string;
  spins: number;
  bet: number;
  win: number;
  ggr: number;
}

export interface OperatorSpin {
  spin_id: string;
  game: string;
  player: string;
  bet_amount: number;
  win_amount: number;
  currency: string;
  created_at: string;
}

export interface UsdTotals {
  bet: number;
  win: number;
  ggr: number;
}

export interface OperatorPlays {
  operator: string;
  by_currency: CurrencyTotals[];
  usd: UsdTotals;
  usd_missing_rate: string[];
}

export interface Paginated<T> {
  results: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface OperatorReportRow {
  code: string;
  name: string;
  spins: number;
  currencies: string[];
  usd: UsdTotals;
  usd_missing_rate: string[];
}

export interface OperatorsReport {
  operators: OperatorReportRow[];
  grand_total_usd: { bet: number; win: number; ggr: number; spins: number };
}

export const listOperators = (token: string) =>
  apiFetch<OperatorRow[]>("/master/operators/", { token });

export const createOperator = (
  token: string,
  body: { name: string; code: string }
) => apiFetch<OperatorRow>("/master/operators/", { method: "POST", body, token });

export const listOperatorKeys = (token: string, code: string) =>
  apiFetch<ApiKeyRow[]>(`/master/operators/${code}/keys/`, { token });

export const createOperatorKey = (token: string, code: string, label: string) =>
  apiFetch<NewApiKey>(`/master/operators/${code}/keys/`, {
    method: "POST",
    body: { label },
    token,
  });

export const listOperatorGames = (token: string, code: string) =>
  apiFetch<OperatorGameRow[]>(`/master/operators/${code}/games/`, { token });

export const assignOperatorGame = (
  token: string,
  code: string,
  game: string,
  is_enabled: boolean
) =>
  apiFetch<{ game: string; assigned: boolean; is_enabled: boolean }>(
    `/master/operators/${code}/games/`,
    { method: "POST", body: { game, is_enabled }, token }
  );

export const getOperatorPlays = (token: string, code: string) =>
  apiFetch<OperatorPlays>(`/master/operators/${code}/plays/`, { token });

export const getOperatorSpins = (token: string, code: string, page = 1, pageSize = 25) =>
  apiFetch<Paginated<OperatorSpin>>(
    `/master/operators/${code}/spins/?page=${page}&page_size=${pageSize}`,
    { token }
  );

export interface OperatorUserRow {
  id: number;
  email: string;
}

export interface OperatorPlayerCurrency {
  currency: string;
  spins: number;
  bet: number;
  win: number;
  ggr: number;
}

export interface OperatorPlayer {
  player: string;
  spins: number;
  currencies: string[];
  by_currency: OperatorPlayerCurrency[];
  usd: UsdTotals;
  usd_missing_rate: string[];
}

export const listOperatorUsers = (token: string, code: string) =>
  apiFetch<OperatorUserRow[]>(`/master/operators/${code}/users/`, { token });

export const createOperatorUser = (token: string, code: string, email: string, password: string) =>
  apiFetch<OperatorUserRow>(`/master/operators/${code}/users/`, {
    method: "POST",
    body: { email, password },
    token,
  });

export const setOperatorUserPassword = (token: string, code: string, userId: number, password: string) =>
  apiFetch<{ id: number; detail: string }>(
    `/master/operators/${code}/users/${userId}/password/`,
    { method: "POST", body: { password }, token }
  );

export const getOperatorPlayers = (token: string, code: string, page = 1, pageSize = 25) =>
  apiFetch<Paginated<OperatorPlayer>>(
    `/master/operators/${code}/players/?page=${page}&page_size=${pageSize}`,
    { token }
  );

export const getOperatorsReport = (token: string) =>
  apiFetch<OperatorsReport>("/master/reports/operators/", { token });
