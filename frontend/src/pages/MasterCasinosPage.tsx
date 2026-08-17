import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  BetProfileSpec,
  CurrencyInfo,
  GameBuildSpec,
  GameRow,
  PayoutSpec,
  SimResult,
  SymbolSpec,
  buildGame,
  grantFreeRounds,
  listCurrencies,
  listGames,
  simulateGame,
  updateGameTheme,
  uploadGameAsset,
  uploadSymbolAsset,
} from "../api/master";
import { MasterNav } from "../components/MasterNav";
import { PaylineEditor } from "../components/PaylineEditor";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Símbolos/pagos del builder. El CÓDIGO (clave interna) se genera solo a partir
// del nombre; el cliente solo sube la imagen y, si quiere, pone un nombre. Cada
// fila tiene un `uid` estable para enlazar el pago con su símbolo sin depender del
// código (que puede cambiar al editar el nombre).
// Los campos numéricos se guardan como TEXTO para poder dejarlos vacíos mientras
// se escribe (se convierten y validan al crear). Evita el "0" pegado.
type SymbolForm = { uid: number; name: string; is_wild: boolean; is_scatter: boolean; weight: string; image?: File };
type PayoutForm = { uid: number; count: string; multiplier: string };
type BetForm = { currency: string; min_bet: string; max_bet: string; default_bet: string; bet_levels: string };

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const autoCode = (name: string, i: number) =>
  stripAccents(name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || `SYM${i + 1}`;

// Mapa uid -> código único (dedup con sufijo numérico si dos nombres colisionan).
function codeMap(symbols: SymbolForm[]): Map<number, string> {
  const used = new Set<string>();
  const m = new Map<number, string>();
  symbols.forEach((s, i) => {
    let code = autoCode(s.name, i);
    const base = code;
    let n = 2;
    while (used.has(code)) code = `${base}${n++}`.slice(0, 20);
    used.add(code);
    m.set(s.uid, code);
  });
  return m;
}

// Assets de nivel de juego que se pueden subir (campo backend -> etiqueta).
const GAME_ASSETS: { field: string; label: string }[] = [
  { field: "thumbnail", label: "Perfil" },
  { field: "logo", label: "Logo" },
  { field: "background_image", label: "Fondo (img/gif)" },
  { field: "background_video", label: "Fondo (video)" },
  { field: "prize_banner", label: "Banner premio" },
  { field: "spin_button", label: "Botón girar" },
  { field: "music_on", label: "Música on" },
  { field: "music_off", label: "Música off" },
  { field: "music_track", label: "Pista música" },
  { field: "turbo_on", label: "Turbo on" },
  { field: "turbo_off", label: "Turbo off" },
  { field: "auto_on", label: "Auto on" },
  { field: "auto_off", label: "Auto off" },
  { field: "bet_plus", label: "Apuesta +" },
  { field: "bet_minus", label: "Apuesta −" },
];

// Assets que NO son imágenes: no se pueden previsualizar como <img>.
const NON_IMAGE_FIELDS = new Set(["background_video", "music_track"]);

// Miniatura del asset ACTUALmente subido (o un hueco "sin imagen"). Para
// vídeo/audio no hay <img>: se muestra solo un indicador de "subido".
function AssetPreview({ url, field }: { url: string | null | undefined; field?: string }) {
  const isFile = field ? NON_IMAGE_FIELDS.has(field) : false;
  if (!url) return <span className="asset-preview empty">sin imagen</span>;
  if (isFile) return <span className="asset-preview file" title={url}>✓ subido</span>;
  return <img className="asset-preview" src={url} alt="" loading="lazy" />;
}

// Editor del TEMA de un casino YA creado: mismos controles de color/fondo que en el
// builder, pero para editarlos después. Solo toca presentación (no la matemática).
function ThemeEditor({ token, game, onSaved }: { token: string; game: GameRow; onSaved: () => void }) {
  const [title, setTitle] = useState(game.title || "");
  const [bg, setBg] = useState(game.background_color || "#101827");
  const [accent, setAccent] = useState(game.accent_color || "#ffd23f");
  const [bgType, setBgType] = useState(game.background_type || "COLOR");
  const [gradient, setGradient] = useState(game.background_gradient || "");
  // RTP en porcentaje; editarlo RE-CALIBRA la paytable en el backend.
  const initialRtpPct = game.target_rtp ? (parseFloat(game.target_rtp) * 100).toString() : "";
  const [rtpPct, setRtpPct] = useState(initialRtpPct);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    const rtpChanged = rtpPct !== initialRtpPct && rtpPct.trim() !== "";
    const rtpNum = parseFloat(rtpPct) / 100;
    if (rtpChanged && (!Number.isFinite(rtpNum) || rtpNum < 0.1 || rtpNum > 1.5)) {
      setErr("El RTP debe estar entre 10% y 150%."); return;
    }
    setSaving(true); setErr(null); setOk(false);
    try {
      await updateGameTheme(token, game.slug, {
        title, background_color: bg, accent_color: accent,
        background_type: bgType, background_gradient: gradient,
        ...(rtpChanged ? { target_rtp: rtpNum.toFixed(4) } : {}),
      });
      setOk(true);
      window.setTimeout(() => setOk(false), 2500);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar el tema");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h4 className="muted">Tema {ok && <span className="inline-ok">✓ guardado</span>}{err && <span className="inline-err">{err}</span>}</h4>
      <div className="field-row">
        <label className="field">
          <span>Título</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={game.name} />
        </label>
        <label className="field sm">
          <span>Color fondo</span>
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
        </label>
        <label className="field sm">
          <span>Color predominante</span>
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
        </label>
        <label className="field sm">
          <span>RTP objetivo (%)</span>
          <input
            type="number" inputMode="decimal" step="0.5" min="10" max="150"
            value={rtpPct} onChange={(e) => setRtpPct(e.target.value)}
            title="Cambiarlo re-calibra la paytable (puede tardar unos segundos)."
          />
        </label>
        <label className="field sm">
          <span>Tipo de fondo</span>
          <select value={bgType} onChange={(e) => setBgType(e.target.value)}>
            <option value="COLOR">Color</option>
            <option value="GRADIENT">Degradado</option>
            <option value="IMAGE">Imagen/GIF</option>
            <option value="VIDEO">Video</option>
          </select>
        </label>
        {bgType === "GRADIENT" && (
          <label className="field">
            <span>Degradado (colores por coma)</span>
            <input value={gradient} onChange={(e) => setGradient(e.target.value)} />
          </label>
        )}
        <button type="button" className="btn primary btn-small" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar tema"}
        </button>
      </div>
    </>
  );
}

// Panel para CONCEDER tiradas gratis a un jugador concreto en ESTE casino.
// Jugador de operador (código de operador + id del jugador) o interno (email).
function FreeRoundsPanel({
  token, slug, currencies, notify,
}: {
  token: string; slug: string; currencies: CurrencyInfo[];
  notify: (t: string, k?: "error" | "ok") => void;
}) {
  const [mode, setMode] = useState<"operator" | "internal">("operator");
  const [operatorCode, setOperatorCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState(currencies[0]?.code ?? "USD");
  const [quantity, setQuantity] = useState("10");
  const [bet, setBet] = useState("");
  const [mult, setMult] = useState("1");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const qn = parseInt(quantity, 10);
    if (!Number.isFinite(qn) || qn < 1) { notify("Cantidad de tiradas inválida."); return; }
    if (mode === "operator" && (!operatorCode || !playerId)) { notify("Indica código de operador e id del jugador."); return; }
    if (mode === "internal" && !email) { notify("Indica el email del jugador interno."); return; }
    setBusy(true);
    try {
      const g = await grantFreeRounds(token, {
        game: slug, currency, quantity: qn,
        ...(mode === "operator" ? { operator_code: operatorCode, external_player_id: playerId } : { player_email: email }),
        ...(bet.trim() ? { bet_amount: parseInt(bet, 10) } : {}),
        win_multiplier: Math.max(1, parseInt(mult, 10) || 1),
        ...(expires ? { expires_at: new Date(expires).toISOString() } : {}),
      });
      notify(`Concedidas ${g.total} tiradas gratis a ${g.player} en ${g.game_title}.`, "ok");
      setPlayerId(""); setEmail("");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Error al conceder tiradas gratis");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4 className="muted">Conceder tiradas gratis</h4>
      <div className="field-row fs-grant">
        <label className="field sm">
          <span>Jugador</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "operator" | "internal")}>
            <option value="operator">De operador</option>
            <option value="internal">Interno (email)</option>
          </select>
        </label>
        {mode === "operator" ? (
          <>
            <label className="field sm">
              <span>Código operador</span>
              <input value={operatorCode} onChange={(e) => setOperatorCode(e.target.value)} placeholder="gangabet" />
            </label>
            <label className="field sm">
              <span>ID jugador</span>
              <input value={playerId} onChange={(e) => setPlayerId(e.target.value)} placeholder="player-123" />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Email jugador</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jugador@correo.com" />
          </label>
        )}
        <label className="field sm">
          <span>Moneda</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </label>
        <label className="field sm">
          <span>Cantidad</span>
          <input type="text" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="field sm">
          <span>Apuesta (opc.)</span>
          <input type="text" inputMode="numeric" value={bet} onChange={(e) => setBet(e.target.value)} placeholder="por defecto" title="Unidades menores; vacío = apuesta por defecto del juego" />
        </label>
        <label className="field sm">
          <span>Multiplicador</span>
          <input type="text" inputMode="numeric" value={mult} onChange={(e) => setMult(e.target.value)} />
        </label>
        <label className="field sm">
          <span>Caduca (opc.)</span>
          <input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <button type="button" className="btn primary btn-small" onClick={submit} disabled={busy}>
          {busy ? "Concediendo…" : "Conceder"}
        </button>
      </div>
    </>
  );
}

const DEFAULT_SYMBOLS: SymbolForm[] = [
  { uid: 1, name: "Comodín", is_wild: true, is_scatter: false, weight: "2" },
  { uid: 2, name: "As", is_wild: false, is_scatter: false, weight: "3" },
  { uid: 3, name: "Rey", is_wild: false, is_scatter: false, weight: "4" },
  { uid: 4, name: "Reina", is_wild: false, is_scatter: false, weight: "5" },
  { uid: 5, name: "Jota", is_wild: false, is_scatter: false, weight: "6" },
  { uid: 6, name: "Diez", is_wild: false, is_scatter: false, weight: "10" },
];
const DEFAULT_PAYOUTS: PayoutForm[] = [
  { uid: 1, count: "3", multiplier: "134" },
  { uid: 2, count: "3", multiplier: "53.5" },
  { uid: 3, count: "3", multiplier: "26.75" },
  { uid: 4, count: "3", multiplier: "13.9" },
  { uid: 5, count: "3", multiplier: "6.95" },
  { uid: 6, count: "3", multiplier: "2.68" },
];
const DEFAULT_BETS: BetForm[] = [
  { currency: "USD", min_bet: "20", max_bet: "50000", default_bet: "100", bet_levels: "20,50,100,200,500" },
];

const toInt = (s: string, fallback = 0) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
};

export default function MasterCasinosPage() {
  const { token } = useAuth();
  const [games, setGames] = useState<GameRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sims, setSims] = useState<Record<string, SimResult | "loading">>({});
  // Notificación tipo banner (reemplaza los alert() del navegador).
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const notify = (text: string, kind: "error" | "ok" = "error") => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice((n) => (n && n.text === text ? null : n)), 5000);
  };

  // Estado del builder.
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [colsStr, setColsStr] = useState("3");
  const [rowsStr, setRowsStr] = useState("3");
  const [winMode, setWinMode] = useState<"LINES" | "WAYS">("LINES");
  const [volatility, setVolatility] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  // RTP objetivo en PORCENTAJE (libre: 10%–150%). Se convierte a fracción al crear.
  const [rtpPct, setRtpPct] = useState("95");
  const [bgColor, setBgColor] = useState("#101827");
  const [accent, setAccent] = useState("#ffd23f");
  const [bgType, setBgType] = useState<"COLOR" | "GRADIENT" | "IMAGE" | "VIDEO">("COLOR");
  const [gradient, setGradient] = useState("#101827,#05030f");
  const [symbols, setSymbols] = useState<SymbolForm[]>(DEFAULT_SYMBOLS);
  const [payouts, setPayouts] = useState<PayoutForm[]>(DEFAULT_PAYOUTS);
  const [bets, setBets] = useState<BetForm[]>(DEFAULT_BETS);
  const [lines, setLines] = useState<number[][]>([]);
  // Tiradas gratis (opcional).
  const [fsOn, setFsOn] = useState(false);
  const [fsTrigger, setFsTrigger] = useState("3");
  const [fsSpins, setFsSpins] = useState("10");
  const [fsMult, setFsMult] = useState("2");
  const [fsRetrigger, setFsRetrigger] = useState(true);
  const nextUid = useRef(7); // los defaults usan uid 1..6

  // Dimensiones válidas derivadas (mientras el input está vacío usa el mínimo).
  const cols = Math.min(7, Math.max(3, toInt(colsStr, 3)));
  const rows = Math.min(6, Math.max(3, toInt(rowsStr, 3)));

  // Si cambia el tamaño de la grilla, las líneas dibujadas dejan de ser válidas.
  useEffect(() => { setLines([]); }, [cols, rows]);

  const load = useCallback(async () => {
    try {
      setGames(await listGames(token!));
      setCurrencies(await listCurrencies(token!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // -- helpers de edición de listas -------------------------------------- //
  const patchSym = (i: number, p: Partial<SymbolForm>) =>
    setSymbols((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const patchPay = (i: number, p: Partial<PayoutForm>) =>
    setPayouts((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const patchBet = (i: number, p: Partial<BetForm>) =>
    setBets((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function create(e: FormEvent) {
    e.preventDefault();
    const slug = slugify(name);
    if (!slug) return;

    // Validación en tiempo de creación de los campos numéricos escritos como texto.
    if (symbols.length < 3) { notify("Se requieren al menos 3 símbolos."); return; }
    const rtpNum = parseFloat(rtpPct) / 100;
    if (!Number.isFinite(rtpNum) || rtpNum < 0.1 || rtpNum > 1.5) {
      notify("El RTP objetivo debe estar entre 10% y 150% (ej. 95)."); return;
    }
    for (const b of bets) {
      const mn = toInt(b.min_bet), mx = toInt(b.max_bet), df = toInt(b.default_bet);
      if (mn < 1 || mx < 1 || df < 1 || !(mn <= df && df <= mx)) {
        notify(`Revisa la moneda ${b.currency}: deben cumplirse mín ≤ por defecto ≤ máx, y todos ≥ 1.`);
        return;
      }
    }
    for (const p of payouts) {
      if (!Number.isFinite(parseFloat(p.multiplier))) { notify("Hay un multiplicador vacío o inválido en los pagos."); return; }
    }

    // Código único autogenerado por símbolo (uid -> código).
    const codeOf = codeMap(symbols);
    const specSymbols: SymbolSpec[] = symbols.map((s) => ({
      code: codeOf.get(s.uid)!, name: s.name || codeOf.get(s.uid)!,
      is_wild: s.is_wild, is_scatter: s.is_scatter, weight: Math.max(1, toInt(s.weight, 1)),
    }));
    const validUids = new Set(symbols.map((s) => s.uid));
    const specPayouts: PayoutSpec[] = payouts
      .filter((p) => validUids.has(p.uid))
      .map((p) => ({ code: codeOf.get(p.uid)!, count: Math.max(1, toInt(p.count, 1)), multiplier: p.multiplier }));
    const specBets: BetProfileSpec[] = bets.map((b) => ({
      currency: b.currency, min_bet: toInt(b.min_bet), max_bet: toInt(b.max_bet), default_bet: toInt(b.default_bet),
      bet_levels: b.bet_levels.split(",").map((x) => toInt(x.trim())).filter((x) => x > 0),
    }));
    const spec: GameBuildSpec = {
      name, slug, title: title || name,
      grid_cols: cols, grid_rows: rows, win_mode: winMode, volatility,
      max_win_multiplier: 5000, background_color: bgColor, accent_color: accent,
      background_type: bgType, background_gradient: bgType === "GRADIENT" ? gradient : "",
      target_rtp: rtpNum.toFixed(4), symbols: specSymbols, payouts: specPayouts,
      paylines: winMode === "LINES" ? lines : [], bet_profiles: specBets,
      free_spins: fsOn
        ? {
            is_active: true,
            trigger_scatter_count: Math.max(2, toInt(fsTrigger, 3)),
            spins_awarded: Math.max(1, toInt(fsSpins, 10)),
            multiplier: Math.max(1, toInt(fsMult, 1)),
            retrigger: fsRetrigger,
          }
        : undefined,
    };
    setBusy(true);
    try {
      await buildGame(token!, spec);
      // Sube los sprites elegidos en el formulario para cada símbolo con imagen.
      for (const s of symbols) {
        if (s.image) {
          try { await uploadSymbolAsset(token!, slug, codeOf.get(s.uid)!, s.image); } catch { /* sigue */ }
        }
      }
      setName(""); setTitle("");
      await load();
      notify(`Casino "${spec.title}" creado. Súbele assets y verifica el RTP.`, "ok");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setBusy(false);
    }
  }

  async function runSim(slug: string) {
    setSims((s) => ({ ...s, [slug]: "loading" }));
    try {
      const res = await simulateGame(token!, slug, 100000);
      setSims((s) => ({ ...s, [slug]: res }));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Error al simular");
      setSims((s) => { const c = { ...s }; delete c[slug]; return c; });
    }
  }

  async function upSymbol(slug: string, code: string, file: File) {
    try { await uploadSymbolAsset(token!, slug, code, file); await load(); }
    catch (err) { notify(err instanceof Error ? err.message : "Error al subir"); }
  }
  async function upAsset(slug: string, field: string, file: File) {
    try { await uploadGameAsset(token!, slug, field, file); await load(); }
    catch (err) { notify(err instanceof Error ? err.message : "Error al subir"); }
  }

  const codes = codeMap(symbols); // códigos autogenerados (para mostrar/enlazar pagos)

  return (
    <div className="master-shell">
      <MasterNav />
      <main className="master-main">
        {error && <p className="error">{error}</p>}
        {notice && (
          <div className={`toast ${notice.kind}`} onClick={() => setNotice(null)}>
            {notice.text}
          </div>
        )}

        {/* ---------------- Builder ---------------- */}
        <section className="card">
          <h2>Crear casino</h2>
          <form onSubmit={create} className="builder">
            <div className="field-row">
              <label className="field">
                <span>Nombre</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Título</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={name} />
              </label>
              <span className="field slug-hint">slug: {slugify(name) || "—"}</span>
            </div>

            <div className="field-row">
              <label className="field sm">
                <span>Rodillos (col)</span>
                <input type="text" inputMode="numeric" value={colsStr} onChange={(e) => setColsStr(e.target.value)} />
              </label>
              <label className="field sm">
                <span>Filas</span>
                <input type="text" inputMode="numeric" value={rowsStr} onChange={(e) => setRowsStr(e.target.value)} />
              </label>
              <label className="field sm">
                <span>Modo</span>
                <select value={winMode} onChange={(e) => setWinMode(e.target.value as "LINES" | "WAYS")}>
                  <option value="LINES">Líneas</option>
                  <option value="WAYS">Ways</option>
                </select>
              </label>
              <label className="field sm">
                <span>Volatilidad</span>
                <select value={volatility} onChange={(e) => setVolatility(e.target.value as "LOW" | "MEDIUM" | "HIGH")}>
                  <option value="LOW">Baja</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                </select>
              </label>
              <label className="field sm">
                <span>RTP objetivo (%)</span>
                <input
                  type="number" inputMode="decimal" step="0.5" min="10" max="150"
                  value={rtpPct} onChange={(e) => setRtpPct(e.target.value)}
                  title="El que tú quieras (10–150%). El motor cuadra la paytable a este valor."
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field sm">
                <span>Color fondo</span>
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
              </label>
              <label className="field sm">
                <span>Color predominante</span>
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
              </label>
              <label className="field sm">
                <span>Tipo de fondo</span>
                <select value={bgType} onChange={(e) => setBgType(e.target.value as typeof bgType)}>
                  <option value="COLOR">Color</option>
                  <option value="GRADIENT">Degradado</option>
                  <option value="IMAGE">Imagen/GIF</option>
                  <option value="VIDEO">Video</option>
                </select>
              </label>
              {bgType === "GRADIENT" && (
                <label className="field">
                  <span>Degradado (colores separados por coma)</span>
                  <input value={gradient} onChange={(e) => setGradient(e.target.value)} />
                </label>
              )}
            </div>

            {/* Símbolos: sube la imagen y (opcional) el nombre; el código es automático. */}
            <h3>Símbolos <span className="muted">(mín. 3; sube imagen y nombre — el código se genera solo)</span></h3>
            <div className="spec-list">
              {symbols.map((s, i) => (
                <div className="spec-row" key={s.uid}>
                  <label className={`sym-img ${s.image ? "has" : ""}`} title="Imagen del símbolo">
                    {s.image ? "✓ imagen" : "📷 imagen"}
                    <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) patchSym(i, { image: f }); }} />
                  </label>
                  <input className="w-name" value={s.name} onChange={(e) => patchSym(i, { name: e.target.value })} placeholder="Nombre (ej. Cereza)" />
                  <span className="code-hint" title="Código interno autogenerado">{codes.get(s.uid)}</span>
                  <label className="chk"><input type="checkbox" checked={s.is_wild} onChange={(e) => patchSym(i, { is_wild: e.target.checked })} /> wild</label>
                  <label className="chk" title="Símbolo que dispara las tiradas gratis"><input type="checkbox" checked={s.is_scatter} onChange={(e) => patchSym(i, { is_scatter: e.target.checked })} /> scatter</label>
                  <input className="w-num" type="text" inputMode="numeric" value={s.weight} onChange={(e) => patchSym(i, { weight: e.target.value })} title="peso (frecuencia)" />
                  <button type="button" className="link" onClick={() => { const uid = s.uid; setSymbols((xs) => xs.filter((x) => x.uid !== uid)); setPayouts((ps) => ps.filter((p) => p.uid !== uid)); }}>✕</button>
                </div>
              ))}
              <button type="button" className="btn ghost btn-small" onClick={() => setSymbols((xs) => [...xs, { uid: nextUid.current++, name: "", is_wild: false, is_scatter: false, weight: "4" }])}>+ símbolo</button>
            </div>

            {/* Tiradas gratis (opcional): scatters disparan una ronda con multiplicador. */}
            <h3>
              Tiradas gratis{" "}
              <label className="chk fs-toggle">
                <input type="checkbox" checked={fsOn} onChange={(e) => setFsOn(e.target.checked)} /> activar
              </label>
            </h3>
            {fsOn && (
              <div className="field-row fs-config">
                <label className="field sm">
                  <span>Scatters para disparar</span>
                  <input type="text" inputMode="numeric" value={fsTrigger} onChange={(e) => setFsTrigger(e.target.value)} />
                </label>
                <label className="field sm">
                  <span>Tiros gratis</span>
                  <input type="text" inputMode="numeric" value={fsSpins} onChange={(e) => setFsSpins(e.target.value)} />
                </label>
                <label className="field sm">
                  <span>Multiplicador</span>
                  <input type="text" inputMode="numeric" value={fsMult} onChange={(e) => setFsMult(e.target.value)} />
                </label>
                <label className="chk fs-retrigger">
                  <input type="checkbox" checked={fsRetrigger} onChange={(e) => setFsRetrigger(e.target.checked)} /> re-disparo
                </label>
                <span className="field muted">Marca arriba qué símbolo es <b>scatter</b>. Verifica el RTP tras crear: las tiradas gratis lo suben.</span>
              </div>
            )}

            {/* Líneas de pago: editor visual (solo modo LINES). En WAYS no hay líneas. */}
            {winMode === "LINES" ? (
              <>
                <h3>Líneas de pago <span className="muted">(dibuja dónde se forman los premios)</span></h3>
                <PaylineEditor cols={cols} rows={rows} lines={lines} onChange={setLines} accent={accent} />
              </>
            ) : (
              <>
                <h3>Formas de ganar <span className="muted">(modo Ways)</span></h3>
                <p className="muted ways-note">
                  En modo <b>Ways</b> no se dibujan líneas: se gana con el mismo símbolo en
                  rodillos <b>adyacentes desde la izquierda</b>, en cualquier fila
                  ({rows}×{cols} = <b>{Math.pow(rows, cols)} formas</b>). Solo defines los
                  pagos por símbolo abajo.
                </p>
              </>
            )}

            {/* Pagos por símbolo: cuánto paga cada símbolo según cuántos salgan. */}
            <h3>
              Pagos por símbolo{" "}
              <span className="muted">
                (símbolo · {winMode === "LINES" ? "nº en la línea" : "nº de rodillos"} · multiplicador)
              </span>
            </h3>
            <div className="spec-list">
              {payouts.map((p, i) => (
                <div className="spec-row" key={i}>
                  <select className="w-name" value={p.uid} onChange={(e) => patchPay(i, { uid: +e.target.value })}>
                    {symbols.map((s) => (
                      <option key={s.uid} value={s.uid}>{s.name || codes.get(s.uid)}</option>
                    ))}
                  </select>
                  <input className="w-num" type="text" inputMode="numeric" value={p.count} onChange={(e) => patchPay(i, { count: e.target.value })} title={winMode === "LINES" ? "cantidad en línea" : "nº de rodillos"} />
                  <span className="mult-x">paga ×</span>
                  <input className="w-num" value={p.multiplier} onChange={(e) => patchPay(i, { multiplier: e.target.value })} title="multiplicador" />
                  <button type="button" className="link" onClick={() => setPayouts((xs) => xs.filter((_, k) => k !== i))}>✕</button>
                </div>
              ))}
              <button type="button" className="btn ghost btn-small" onClick={() => setPayouts((xs) => [...xs, { uid: symbols[0]?.uid ?? 1, count: "3", multiplier: "1" }])}>+ pago</button>
            </div>

            {/* Monedas */}
            <h3>Apuestas por moneda <span className="muted">(multimoneda)</span></h3>
            <div className="spec-list">
              {bets.map((b, i) => (
                <div className="spec-row" key={i}>
                  <select className="w-code" value={b.currency} onChange={(e) => patchBet(i, { currency: e.target.value })}>
                    {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                  </select>
                  <input className="w-num" type="text" inputMode="numeric" value={b.min_bet} onChange={(e) => patchBet(i, { min_bet: e.target.value })} title="mín" />
                  <input className="w-num" type="text" inputMode="numeric" value={b.default_bet} onChange={(e) => patchBet(i, { default_bet: e.target.value })} title="por defecto" />
                  <input className="w-num" type="text" inputMode="numeric" value={b.max_bet} onChange={(e) => patchBet(i, { max_bet: e.target.value })} title="máx" />
                  <input className="w-levels" value={b.bet_levels} onChange={(e) => patchBet(i, { bet_levels: e.target.value })} title="niveles (separados por coma)" placeholder="20,50,100" />
                  <button type="button" className="link" onClick={() => setBets((xs) => xs.filter((_, k) => k !== i))}>✕</button>
                </div>
              ))}
              <button type="button" className="btn ghost btn-small" onClick={() => setBets((xs) => [...xs, { currency: currencies[0]?.code ?? "USD", min_bet: "20", max_bet: "50000", default_bet: "100", bet_levels: "20,50,100" }])}>+ moneda</button>
            </div>

            <button className="btn primary" disabled={busy || !name}>Crear casino</button>
            <p className="muted">Tras crear, súbele los assets y corre la simulación de RTP para verificar el %.</p>
          </form>
        </section>

        {/* ---------------- Casinos existentes ---------------- */}
        {games.map((g) => {
          const sim = sims[g.slug];
          return (
            <section className="card" key={g.slug}>
              <div className="game-head">
                {g.thumbnail ? <img className="game-thumb" src={g.thumbnail} alt="" /> : <div className="game-thumb ph">🎰</div>}
                <div>
                  <h2>{g.title || g.name}</h2>
                  <p className="muted">{g.slug} · {g.grid.cols}×{g.grid.rows} · {g.win_mode} · assets {g.assets}/{g.symbols}</p>
                </div>
                <button className="btn ghost btn-small sim-btn" onClick={() => runSim(g.slug)} disabled={sim === "loading"}>
                  {sim === "loading" ? "Simulando…" : "Simular RTP"}
                </button>
              </div>

              {sim && sim !== "loading" && (
                <div className={`sim-result ${Math.abs(sim.deviation) <= 0.01 ? "ok" : "warn"}`}>
                  <span>RTP medido <b>{(sim.rtp * 100).toFixed(2)}%</b></span>
                  <span>objetivo {(sim.target_rtp * 100).toFixed(2)}%</span>
                  <span>desviación {(sim.deviation * 100 >= 0 ? "+" : "") + (sim.deviation * 100).toFixed(2)}%</span>
                  <span>hit {(sim.hit_rate * 100).toFixed(1)}%</span>
                  <span className="muted">{sim.spins.toLocaleString()} tiros</span>
                </div>
              )}

              <ThemeEditor token={token!} game={g} onSaved={load} />

              <h4 className="muted">Símbolos</h4>
              <div className="assets-grid">
                {g.symbol_codes.map((code) => (
                  <label key={code} className="asset-cell">
                    <AssetPreview url={g.symbol_assets?.[code]} />
                    <span>{code}</span>
                    <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) upSymbol(g.slug, code, f); e.target.value = ""; }} />
                  </label>
                ))}
              </div>

              <h4 className="muted">Assets del casino</h4>
              <div className="assets-grid">
                {GAME_ASSETS.map((a) => (
                  <label key={a.field} className="asset-cell">
                    <AssetPreview url={g.asset_urls?.[a.field]} field={a.field} />
                    <span>{a.label}</span>
                    <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upAsset(g.slug, a.field, f); e.target.value = ""; }} />
                  </label>
                ))}
              </div>

              <FreeRoundsPanel token={token!} slug={g.slug} currencies={currencies} notify={notify} />
            </section>
          );
        })}
      </main>
    </div>
  );
}
