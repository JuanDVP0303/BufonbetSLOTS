import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { makeGameConfig } from "../game/config";
import { isLandscapeNow, isMobileDeviceClass } from "../game/mobile/configMobile";
import type { SpinResponse } from "../api/spinApi";
import type { Theme } from "../api/play";

interface Props {
  spin: (betAmount: number) => Promise<SpinResponse>;
  betAmount: number;
  onBalance?: (balance: number) => void;
  onSpinError?: (err: unknown) => boolean;
  onShowPaytable?: () => void;
  // CORRECCIÓN D1 (punto 6, SOLO ESCRITORIO): le pasa al padre (PlayPage/
  // EmbedPage) una función para alternar pantalla completa, así el botón
  // vive en el MISMO header DOM que atrás/salir (mismo margen, misma fila) en
  // vez de dibujarse aparte dentro del canvas de Phaser. Solo se llama si
  // `!isMobile` (ver más abajo) — en móvil el padre nunca recibe nada.
  onFullscreenReady?: (toggle: () => void) => void;
  // SOLO MÓVIL: le pasa al padre (PlayPage) la posición Y del ícono de SONIDO
  // (junto al logo, dentro del canvas) como fracción (0-1) de la altura real
  // de la ventana — así el ícono de HOME del header (DOM, fuera del canvas)
  // puede alinearse a la misma altura en vez de quedar pegado arriba del
  // todo. Se reemite en cada resize/orientationchange (ver computeLayoutMobile).
  onTopIconY?: (frac: number) => void;
  theme?: Theme;
  grid?: { cols: number; rows: number };
  balance?: number;
  currency?: string;
  currencySymbol?: string;
  currencyExponent?: number;
  betLevels?: number[];
  betMin?: number;
  betMax?: number;
}

/**
 * Envuelve el juego de Phaser 3 en React de forma limpia (crea/destruye).
 * `spin`/`onBalance` se leen vía refs para no recrear el juego en cada render.
 * El `theme` se captura al crear el juego; para cambiar de casino, el padre
 * remonta este componente con una `key` distinta.
 */
export default function SlotGameCanvas({
  spin,
  betAmount,
  onBalance,
  onSpinError,
  onShowPaytable,
  onFullscreenReady,
  onTopIconY,
  theme,
  grid,
  balance,
  currency,
  currencySymbol,
  currencyExponent,
  betLevels,
  betMin,
  betMax,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  // DESKTOP (Fase 1): wrapper que entra en pantalla completa junto con el
  // juego (ver game/config.ts, `fullscreenTarget`) — así no queda SOLO el
  // <canvas> en pantalla completa, sino también el aviso de "gira tu
  // teléfono" y cualquier capa DOM que se agregue más adelante.
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const spinRef = useRef(spin);
  const balanceRef = useRef(onBalance);
  const errorRef = useRef(onSpinError);
  const paytableRef = useRef(onShowPaytable);
  const fullscreenReadyRef = useRef(onFullscreenReady);
  const topIconYRef = useRef(onTopIconY);
  spinRef.current = spin;
  balanceRef.current = onBalance;
  errorRef.current = onSpinError;
  paytableRef.current = onShowPaytable;
  fullscreenReadyRef.current = onFullscreenReady;
  topIconYRef.current = onTopIconY;

  // Clasificación de DISPOSITIVO (no cambia durante la sesión, aunque rote).
  const isMobileRef = useRef<boolean>();
  if (isMobileRef.current === undefined) isMobileRef.current = isMobileDeviceClass();
  const isMobile = isMobileRef.current;

  // Aviso de "gira tu teléfono": solo en dispositivos móviles, mientras estén
  // en horizontal. En vez de deformar el juego, se oculta todo detrás de este
  // aviso (Fase 1, regla 5).
  const [landscapeWarning, setLandscapeWarning] = useState(() => isMobile && isLandscapeNow());
  useEffect(() => {
    if (!isMobile) return;
    const check = () => setLandscapeWarning(isLandscapeNow());
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!parentRef.current || gameRef.current) return;

    const game = new Phaser.Game(
      makeGameConfig(parentRef.current, {
        betAmount,
        theme,
        grid,
        balance,
        currency,
        currencySymbol,
        currencyExponent,
        betLevels,
        betMin,
        betMax,
        spin: (bet) => spinRef.current(bet),
        onBalance: (b) => balanceRef.current?.(b),
        onSpinError: (err) => errorRef.current?.(err) ?? false,
        onShowPaytable: () => paytableRef.current?.(),
      },
        wrapRef.current ?? undefined
      )
    );
    gameRef.current = game;

    // CORRECCIÓN D1 (punto 6, SOLO ESCRITORIO): el padre dibuja el botón de
    // pantalla completa en su propio header DOM (junto a atrás/salir, mismo
    // margen/fila) — acá solo se le entrega la función real que lo activa.
    if (!isMobile) {
      fullscreenReadyRef.current?.(() => gameRef.current?.scale.toggleFullscreen());
    }

    // Posición del ícono de SONIDO (ver computeLayoutMobile) para alinear el
    // HOME del header DOM — se reemite en cada resize/orientationchange.
    const onTopIconYEvt = (frac: number) => topIconYRef.current?.(frac);
    game.events.on("mobile-top-icon-y", onTopIconYEvt);

    return () => {
      game.events.off("mobile-top-icon-y", onTopIconYEvt);
      game.destroy(true);
      gameRef.current = null;
    };
    // theme/betAmount son estables por casino; el remonte se hace vía `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fondo ANIMADO detrás del canvas (transparente):
  //  - GIF  -> <img> (anima nativo, sin restricciones de autoplay). Vía preferida.
  //  - VIDEO -> <video> muted (por si algún casino usa video).
  // Estos dos YA cubren toda su caja (.slot-bg-video { inset:0; object-fit:cover }),
  // así que en móvil (donde esa caja es ahora la pantalla completa) ya quedan
  // "full-bleed" sin cambios.
  const bgType = theme?.background_type;
  const bgUrl = theme?.assets?.background;
  const gifUrl = bgType === "IMAGE" && bgUrl && bgUrl.toLowerCase().endsWith(".gif") ? bgUrl : null;
  const videoUrl = bgType === "VIDEO" ? theme?.assets?.background_video ?? null : null;
  const staticImgUrl = bgType === "IMAGE" && bgUrl && !gifUrl ? bgUrl : null;

  // El <video> necesita muted por propiedad (bug de React) para autoplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.setAttribute("webkit-playsinline", "true");
    v.play().catch(() => {});
  }, [videoUrl]);

  // SOLO MÓVIL: el canvas de Phaser usa Scale.FIT a resolución fija (ver
  // game/config.ts), así que deja franjas vacías alrededor cuando la pantalla
  // real no tiene exactamente la proporción de diseño. Para que esas franjas
  // NO se vean como "barras negras" (regla 2 de la Fase 1), se pinta ahí una
  // capa de fondo "cover" a pantalla completa, aparte de GIF/video (que ya lo
  // hacían): una imagen estática, un degradado, o el color sólido del tema.
  // Escritorio no usa esto — su fondo sigue pintándose solo dentro de Phaser,
  // exactamente como antes.
  const gradientStops = (theme?.background_gradient || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mobileCoverStyle: React.CSSProperties | null =
    isMobile && !gifUrl && !videoUrl
      ? staticImgUrl
        ? null // se resuelve con <img>, no con estilo de fondo
        : {
            background:
              bgType === "GRADIENT" && gradientStops.length
                ? `linear-gradient(180deg, ${gradientStops.join(", ")})`
                : theme?.background_color || "#0b0f1a",
          }
      : null;

  return (
    <div className="slot-canvas-wrap" ref={wrapRef}>
      {landscapeWarning && (
        <div className="rotate-overlay" role="alert">
          <div className="rotate-card">
            <div className="rotate-icon" aria-hidden="true">
              ⟳
            </div>
            <p>Gira tu teléfono a vertical para jugar</p>
          </div>
        </div>
      )}
      <div className="slot-frame">
        {isMobile && staticImgUrl && (
          <img className="slot-bg-cover mobile-bg-pan" src={staticImgUrl} alt="" aria-hidden="true" />
        )}
        {isMobile && mobileCoverStyle && (
          <div className="slot-bg-cover mobile-bg-pan" style={mobileCoverStyle} aria-hidden="true" />
        )}
        {gifUrl && (
          <img
            className={"slot-bg-video" + (isMobile ? " mobile-bg-pan" : "")}
            src={gifUrl}
            alt=""
            aria-hidden="true"
          />
        )}
        {videoUrl && (
          <video
            ref={videoRef}
            className={"slot-bg-video" + (isMobile ? " mobile-bg-pan" : "")}
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
          />
        )}
        {isMobile && <div className="slot-top-vignette" aria-hidden="true" />}
        <div ref={parentRef} className="slot-canvas" />
      </div>
    </div>
  );
}
