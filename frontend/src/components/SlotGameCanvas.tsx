import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { makeGameConfig } from "../game/config";
import type { SpinResponse } from "../api/spinApi";
import type { Theme } from "../api/play";

interface Props {
  spin: (betAmount: number) => Promise<SpinResponse>;
  betAmount: number;
  onBalance?: (balance: number) => void;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const spinRef = useRef(spin);
  const balanceRef = useRef(onBalance);
  spinRef.current = spin;
  balanceRef.current = onBalance;

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
      })
    );
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
    // theme/betAmount son estables por casino; el remonte se hace vía `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fondo ANIMADO detrás del canvas (transparente):
  //  - GIF  -> <img> (anima nativo, sin restricciones de autoplay). Vía preferida.
  //  - VIDEO -> <video> muted (por si algún casino usa video).
  const bgType = theme?.background_type;
  const bgUrl = theme?.assets?.background;
  const gifUrl = bgType === "IMAGE" && bgUrl && bgUrl.toLowerCase().endsWith(".gif") ? bgUrl : null;
  const videoUrl = bgType === "VIDEO" ? theme?.assets?.background_video ?? null : null;

  // El <video> necesita muted por propiedad (bug de React) para autoplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.setAttribute("webkit-playsinline", "true");
    v.play().catch(() => {});
  }, [videoUrl]);

  return (
    <div className="slot-canvas-wrap">
      {gifUrl && <img className="slot-bg-video" src={gifUrl} alt="" aria-hidden="true" />}
      {videoUrl && (
        <video
          ref={videoRef}
          className="slot-bg-video"
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
        />
      )}
      <div ref={parentRef} className="slot-canvas" />
    </div>
  );
}
