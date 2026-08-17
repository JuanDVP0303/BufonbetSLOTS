// Cliente HTTP base. Antepone la base de la API y adjunta el JWT si se pasa.
const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Options {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function apiFetch<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Respuesta no-JSON (p.ej. una página de error HTML del servidor).
    data = null;
  }
  if (!res.ok) {
    const err = data as { detail?: string; code?: string } | null;
    throw new ApiError(err?.detail ?? `HTTP ${res.status}`, res.status, err?.code);
  }
  return data as T;
}

/** Subida multipart (archivos). No fija Content-Type: el navegador pone el boundary. */
export async function apiUpload<T>(path: string, formData: FormData, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method: "POST", headers, body: formData });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data as { detail?: string; code?: string } | null;
    throw new ApiError(err?.detail ?? `HTTP ${res.status}`, res.status, err?.code);
  }
  return data as T;
}
