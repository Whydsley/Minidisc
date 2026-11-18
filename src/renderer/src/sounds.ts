let ctx: AudioContext | null = null

export function playCue(kind: 'join' | 'leave'): void {
  const c = ctx ?? (ctx = new AudioContext())
  c.resume().catch(() => {})
  const notes = kind === 'join' ? [660, 880] : [880, 520]
  const t0 = c.currentTime
  notes.forEach((freq, i) => {
    const osc = c.createOscillator()
    const gain = c.createGain()
    const start = t0 + i * 0.12
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(start)
    osc.stop(start + 0.18)
  })
}