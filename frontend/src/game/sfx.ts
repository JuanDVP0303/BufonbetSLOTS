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
};
