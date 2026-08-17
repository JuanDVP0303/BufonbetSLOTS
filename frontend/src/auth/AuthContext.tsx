import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as authApi from "../api/auth";
import type { AuthUser } from "../api/auth";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = "slot_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Al cargar (o al cambiar el token), valida contra /auth/me y recupera el usuario.
  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const m = await authApi.me(token);
        if (active) setUser({ id: m.id, email: m.email, role: m.role });
      } catch {
        if (active) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, [token]);

  const persist = (access: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, access);
    setToken(access);
    setUser(u);
  };

  const login = async (email: string, password: string) => {
    const r = await authApi.login(email, password);
    persist(r.tokens.access, r.user);
  };

  const register = async (email: string, password: string) => {
    const r = await authApi.register(email, password);
    persist(r.tokens.access, r.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  return ctx;
}
