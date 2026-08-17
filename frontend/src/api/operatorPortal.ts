import { apiFetch } from "./client";
import type { CurrencyTotals, OperatorPlayer, OperatorSpin, Paginated, UsdTotals } from "./operators";

/** Back office del PROPIO operador (login de operador). Solo ve sus datos. */
export interface OperatorMe {
  operator: string;
  name: string;
  by_currency: CurrencyTotals[];
  usd: UsdTotals;
  usd_missing_rate: string[];
}

export const getMyOperator = (token: string) =>
  apiFetch<OperatorMe>("/operator/me/", { token });

export const getMyOperatorSpins = (token: string, page = 1, pageSize = 25) =>
  apiFetch<Paginated<OperatorSpin>>(
    `/operator/me/spins/?page=${page}&page_size=${pageSize}`,
    { token }
  );

export const getMyOperatorPlayers = (token: string, page = 1, pageSize = 25) =>
  apiFetch<Paginated<OperatorPlayer>>(
    `/operator/me/players/?page=${page}&page_size=${pageSize}`,
    { token }
  );
