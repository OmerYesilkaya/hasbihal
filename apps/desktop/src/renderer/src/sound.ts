/**
 * The notification chime (A28): two soft rising notes, made with Web Audio, so there's no sound
 * file to ship or license, and it sounds the same on macOS and Windows.
 */
let context: AudioContext | null = null;

export function playChime(): void {
  context ??= new AudioContext();
  const ctx = context;
  if (ctx.state === 'suspended') void ctx.resume();
  const start = ctx.currentTime + 0.01;
  // E5, then A5.
  for (const [i, frequency] of [659.25, 880].entries()) {
    const at = start + i * 0.12;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  }
}
