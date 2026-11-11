/**
 * Efectos de sonido sintetizados con la Web Audio API.
 *
 * Se usa síntesis (osciladores) para que el demo tenga audio SIN archivos
 * binarios. Para producción, carga audio real en PreloadScene con
 * `this.load.audio(...)` y reprodúcelo con el gestor de sonido de Phaser;
 * este módulo puede quedar como fallback.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Los navegadores exigen resume() tras interacción del usuario.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType, gain = 0.15, delayMs = 0) {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delayMs / 1000;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  vol.gain.setValueAtTime(0.0001, start);
  vol.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  vol.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(vol).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

export const sfx = {
  // Interacción del usuario que desbloquea el audio del navegador.
  unlock() {
    audio();
  },
  // Pestaña oculta (solo escritorio): suspende el hilo de audio; se reanuda al volver.
  suspend() {
    if (ctx && ctx.state === "running") void ctx.suspend();
  },
  resume() {
    if (ctx && ctx.state === "suspended") void ctx.resume();
  },
  spin() {
    tone(180, 120, "square", 0.08);
  },
  reelStop() {
    tone(320, 70, "triangle", 0.1);
  },
  win() {
    tone(660, 120, "sine", 0.14);
    tone(880, 160, "sine", 0.14, 100);
  },
  bigWin() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => tone(f, 220, "sawtooth", 0.14, i * 110));
  },
  // Tensión ascendente mientras se resuelven los últimos carretes camino de un
  // trigger de scatter (anticipación).
  anticipation() {
    const notes = [220, 262, 311, 370];
    notes.forEach((f, i) => tone(f, 180, "sawtooth", 0.06, i * 140));
  },
  // Tick corto para el contador de ganancia (roll-up).
  tick() {
    tone(980, 40, "square", 0.05);
  },
  freeSpinsIntro() {
    const notes = [392, 523, 659, 784, 988];
    notes.forEach((f, i) => tone(f, 180, "triangle", 0.13, i * 90));
  },
  freeSpinsOutro() {
    const notes = [988, 784, 659, 523];
    notes.forEach((f, i) => tone(f, 200, "sine", 0.13, i * 110));
  },

  // --- Fase 6 (HUD móvil): hooks nuevos, sintetizados como todo lo demás —
  // en cuanto haya archivos reales, basta con cambiar el cuerpo de cada
  // función (ver la lista de assets recomendados al final de la Fase 6). ---

  // Clic corto para CUALQUIER botón del HUD (SPIN, −/+, iconos). Reutilizado
  // por `mobilePressFeedback` en SlotScene, así que no hay que llamarlo a mano
  // en cada botón nuevo.
  buttonClick() {
    tone(740, 35, "square", 0.05);
  },
  // Repique cuando aparece un scatter que dispara la anticipación (distinto
  // del tono ascendente de `anticipation()`, que ya suena por encima mientras
  // frenan los últimos carretes).
  scatterLand() {
    tone(1046, 90, "sine", 0.09);
    tone(1318, 120, "sine", 0.07, 60);
  },
  // Ganancia "escalada por tamaño": un acorde más largo y más lleno cuanto
  // más grande el premio (BIG < MEGA < SUPER < JACKPOT).
  winTier(tier: "big" | "mega" | "super" | "jackpot") {
    const chords: Record<string, number[]> = {
      big: [523, 659, 784],
      mega: [523, 659, 784, 988],
      super: [523, 659, 784, 988, 1245],
      jackpot: [392, 523, 659, 784, 988, 1245, 1568],
    };
    (chords[tier] ?? chords.big).forEach((f, i) => tone(f, 240, "sawtooth", 0.15, i * 90));
  },
};
