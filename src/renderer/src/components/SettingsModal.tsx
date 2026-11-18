import type { NoiseMode } from '../useVoiceRoom'

type Props = {
  mics: MediaDeviceInfo[]
  micId: string
  noise: NoiseMode
  boost: number
  onMic: (id: string) => void
  onNoise: (n: NoiseMode) => void
  onBoost: (n: number) => void
  onClose: () => void
}

export default function SettingsModal(p: Props) {
  return (
    <div className="overlay" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Audio settings</h3>

        <label>Microphone</label>
        <select value={p.micId} onChange={(e) => p.onMic(e.target.value)}>
          <option value="">System default</option>
          {p.mics.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>

        <label>Noise suppression</label>
        <select value={p.noise} onChange={(e) => p.onNoise(e.target.value as NoiseMode)}>
          <option value="off">Off</option>
          <option value="standard">Standard</option>
          <option value="strong">Strong (RNNoise)</option>
        </select>

        <label>Mic boost: {p.boost}%</label>
        <input
          type="range"
          min={100}
          max={400}
          step={10}
          value={p.boost}
          onChange={(e) => p.onBoost(Number(e.target.value))}
        />
        
        <button onClick={() => window.api.openLogs()}>Open logs folder</button>
        <button onClick={p.onClose}>Close</button>
      </div>
    </div>
  )
}