import { apiFetch } from "./client";

export type Role = "PLAYER" | "MASTER" | "OPERATOR";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

interface AuthResult {
  user: AuthUser;
  tokens: { access: string; refresh: string };
}

export interface MeResponse {
  id: number;
  email: string;
  role: Role;
  balance: number;
  currency: string;
}

export const register = (email: string, password: string) =>
  apiFetch<AuthResult>("/auth/register/", { method: "POST", body: { email, password } });

export const login = (email: string, password: string) =>
  apiFetch<AuthResult>("/auth/login/", { method: "POST", body: { email, password } });

export const me = (token: string) => apiFetch<MeResponse>("/auth/me/", { token });
