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
  // Corta la petición si no responde en este tiempo (ApiError status 0, code
  // "timeout"). Sin valor = sin límite (comportamiento de siempre).
  timeoutMs?: number;
}

/** Timeout de las peticiones de GIRO: si el servidor no responde, la escena
 *  detiene los rodillos y muestra el error en vez de girar indefinidamente. */
export const SPIN_TIMEOUT_MS = 30_000;

/**
 * Saca un mensaje legible de CUALQUIER forma de error de DRF:
 *  - {"detail": "..."}                    (errores APIException)
 *  - ["...", "..."]                        (ValidationError a nivel de serializer)
 *  - {"non_field_errors": ["..."], ...}    (validate())
 *  - {"campo": ["error1", "error2"], ...}  (errores por campo)
 */
function extractError(data: unknown, status: number): string {
  // 413 lo devuelve nginx (no Django) como HTML, sin JSON legible: mensaje claro.
  if (status === 413) {
    return "El archivo es demasiado grande para el servidor. Súbelo más liviano " +
      "o pide subir el límite del servidor (nginx: client_max_body_size).";
  }
  if (typeof data === "string" && data) return data;
  if (Array.isArray(data)) return data.map(String).join(" ");
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    const parts: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (key === "code") continue;
      const msg = Array.isArray(val) ? val.map(String).join(" ") : String(val);
      parts.push(key === "non_field_errors" ? msg : `${key}: ${msg}`);
    }
    if (parts.length) return parts.join(" · ");
  }
  return `HTTP ${status}`;
}

export async function apiFetch<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? window.setTimeout(() => ctrl.abort(), opts.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl?.signal,
    });
  } catch (err) {
    if (ctrl?.signal.aborted) {
      throw new ApiError("El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.", 0, "timeout");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Respuesta no-JSON (p.ej. una página de error HTML del servidor).
    data = null;
  }
  if (!res.ok) {
    const code = (data as { code?: string } | null)?.code;
    throw new ApiError(extractError(data, res.status), res.status, code);
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
    const code = (data as { code?: string } | null)?.code;
    throw new ApiError(extractError(data, res.status), res.status, code);
  }
  return data as T;
}
