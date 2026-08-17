import { apiFetch } from "./client";
import type { SpinResponse } from "./spinApi";

export interface ThemeSymbol {
  code: string;
  label: string;
  is_wild: boolean;
  is_scatter?: boolean;
  image_url: string | null;
}

export interface ThemeAssets {
  background: string | null;
  background_video: string | null;
  logo: string | null;
  prize_banner: string | null;
  spin_button: string | null;
  music_on: string | null;
  music_off: string | null;
  music_track: string | null;
  turbo_on: string | null;
  turbo_off: string | null;
  auto_on: string | null;
  auto_off: string | null;
  bet_plus: string | null;
  bet_minus: string | null;
}

export interface Theme {
  title: string;
  background_color: string;
  accent_color?: string;
  background_type?: string;
  background_gradient?: string;
  win_mode?: string;
  /** Solo LINES: una fila por rodillo para cada línea (para resaltar la ganadora). */
  paylines?: number[][];
  symbols: ThemeSymbol[];
  assets?: ThemeAssets;
}

export interface PaytablePayout {
  count: number;
  multiplier: string;
}

export interface PaytableSymbol {
  code: string;
  label: string;
  is_wild: boolean;
  image_url: string | null;
  payouts: PaytablePayout[];
}

export interface Paytable {
  win_mode: string;
  lines: number;
  symbols: PaytableSymbol[];
}

export interface CurrencyDetail {
  code: string;
  exponent: number;
  symbol: string;
}

export interface LaunchResponse {
  game_session: string;
  game: string;
  grid: { cols: number; rows: number };
  win_mode: string;
  balance: number;
  currency: string;
  currency_source: string;
  currency_detail: CurrencyDetail;
  bet: { default: number; min: number; max: number; levels: number[] };
  theme: Theme;
  paytable: Paytable;
}

export interface LobbyGame {
  slug: string;
  title: string;
  grid: { cols: number; rows: number };
  win_mode: string;
  thumbnail: string | null;
  background_color: string;
}

export const listLobby = (token: string) => apiFetch<LobbyGame[]>("/games/", { token });

export const getPaytable = (token: string, slug: string) =>
  apiFetch<Paytable>(`/games/${slug}/paytable/`, { token });

export const launch = (token: string, game: string) =>
  apiFetch<LaunchResponse>("/play/launch/", { method: "POST", body: { game }, token });

export const playSpin = (token: string, gameSession: string, betAmount: number) =>
  apiFetch<SpinResponse>("/play/spin/", {
    method: "POST",
    body: { game_session: gameSession, bet_amount: betAmount },
    token,
  });
