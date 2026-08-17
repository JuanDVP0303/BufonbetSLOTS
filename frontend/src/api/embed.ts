import { apiFetch } from "./client";
import type { Paytable, Theme } from "./play";
import type { SpinResponse } from "./spinApi";

/**
 * API del IFRAME (modo proveedor). Se autentica con el SESSION TOKEN que el backend
 * del operador obtuvo en /provider/launch/ y pasó a la URL del iframe. apiFetch envía
 * ese token como `Authorization: Bearer <token>`. NUNCA se usa aquí la API key del
 * operador (es un secreto server-to-server).
 */
export interface EmbedState {
  game: string;
  grid: { cols: number; rows: number };
  win_mode: string;
  currency: string;
  currency_detail: { code: string; exponent: number; symbol: string };
  bet: { default: number; min: number; max: number; levels: number[] };
  balance: number;
  theme: Theme;
  paytable: Paytable;
}

export const embedState = (sessionToken: string) =>
  apiFetch<EmbedState>("/embed/state/", { token: sessionToken });

export const embedSpin = (sessionToken: string, betAmount: number) =>
  apiFetch<SpinResponse>("/embed/spin/", {
    method: "POST",
    body: { bet_amount: betAmount },
    token: sessionToken,
  });
