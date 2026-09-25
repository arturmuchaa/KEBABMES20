/**
 * Dźwięk kiosku magazynu — werdykt idzie UCHEM, nie okiem.
 *
 * Sedno projektu (spec §5.4): panel MILCZY, gdy jest dobrze. Skaner pika, bo
 * odczytał kod — to nie jest werdykt. Magazynier bierze, skanuje, wkłada,
 * bierze następną; zatrzymuje się dopiero, gdy usłyszy ostry dźwięk.
 *
 * Dwa sygnały i ani jednego więcej:
 *   - `inny`  — krótki, łagodny: przeszło, ale zerknij (sztuka poszła do
 *               INNEGO kartonu, paleta poza kolejnością),
 *   - `blad`  — dwa ostre, opadające tony prostokątne: nie przeszło, stój.
 *
 * Ton należy do SKANERA, nie do ekranu — przy dwóch skanerach (plaster
 * z mostem USB) każdy dostanie własną wysokość.
 */
type Skaner = 'L' | 'P'

const TONY: Record<Skaner, { inny: [number, number]; blad: [number, number][] }> = {
  L: { inny: [660, 130], blad: [[240, 180], [190, 260]] },
  P: { inny: [880, 130], blad: [[330, 180], [260, 260]] },
}

let ctx: AudioContext | null = null

function ton(hz: number, ms: number, glosnosc: number, typ: OscillatorType) {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!ctx) ctx = new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = typ
    osc.frequency.value = hz
    const t = ctx.currentTime
    gain.gain.setValueAtTime(glosnosc, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + ms / 1000)
  } catch {
    // Brak dźwięku nie może zatrzymać pracy — ekran i tak pokaże alarm.
  }
}

export function grajInny(skaner: Skaner = 'L') {
  const [hz, ms] = TONY[skaner].inny
  ton(hz, ms, 0.12, 'sine')
}

export function grajBlad(skaner: Skaner = 'L') {
  const [[a, am], [b, bm]] = TONY[skaner].blad
  ton(a, am, 0.2, 'square')
  setTimeout(() => ton(b, bm, 0.2, 'square'), 200)
}
