/**
 * Krótkie sygnały dźwiękowe dla skanerów QR (Web Audio API).
 * ok  — krótki wysoki ton (~880 Hz, 120 ms)
 * err — krótki niski ton  (~330 Hz, 180 ms)
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq: number, durationMs: number): void {
  try {
    const ac = getCtx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    const now = ac.currentTime
    gain.gain.setValueAtTime(0.18, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)
    osc.start(now)
    osc.stop(now + durationMs / 1000)
  } catch {
    // Web Audio niedostępne — cicho ignoruj
  }
}

export function beepOk():  void { playTone(880, 120) }
export function beepErr(): void { playTone(330, 180) }
