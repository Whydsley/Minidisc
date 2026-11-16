import { useEffect, useState } from 'react'
import { useVoiceRoom, type NoiseMode, type ShareQuality } from './useVoiceRoom'
import { loadPref, normalizeServerUrl, resizeImage, savePref } from './ui'
import TitleBar from './components/TitleBar'
import ConnectScreen from './components/ConnectScreen'
import Sidebar from './components/Sidebar'
import ScreenGrid from './components/ScreenGrid'
import ChatPanel from './components/ChatPanel'
import ControlBar from './components/ControlBar'
import ScreenPicker from './components/ScreenPicker'
import SettingsModal from './components/SettingsModal'

export default function App() {
  const [hostInfo, setHostInfo] = useState<{ localUrl: string; publicUrl: string } | null>(null)
  const [name, setName] = useState(loadPref('name', 'Guest'))
  const [serverUrl, setServerUrl] = useState(
    loadPref('serverUrl', import.meta.env.VITE_SERVER_URL ?? '')
  )
  const [micId, setMicId] = useState(loadPref('micId', ''))
  const [noise, setNoise] = useState<NoiseMode>(loadPref('noise', 'standard') as NoiseMode)
  const [boost, setBoost] = useState(Number(loadPref('boost', '100')))
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState(false)
  const [settings, setSettings] = useState(false)
  const [avatar, setAvatar] = useState(loadPref('avatar', ''))
  const [preview, setPreview] = useState(false)
  const v = useVoiceRoom(name, avatar)

  useEffect(() => {
    const load = async (): Promise<void> => {
      const all = await navigator.mediaDevices.enumerateDevices()
      setMics(all.filter((d) => d.kind === 'audioinput'))
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [v.joined])

  function changeName(n: string): void {
    setName(n)
    savePref('name', n)
  }

  async function changeAvatar(file: File | null) {
    if (!file) {
      setAvatar('')
      savePref('avatar', '')
      return
    }
    try {
      setError('')
      const url = await resizeImage(file)
      setAvatar(url)
      savePref('avatar', url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleJoin() {
    const url = normalizeServerUrl(serverUrl)
    if (!url) return setError('Type the server address first')
    setBusy(true)
    try {
      setError('')
      savePref('serverUrl', url)
      setServerUrl(url)
      v.setMicBoost(boost)
      await v.join(url, micId, noise)
    } catch (e) {
      setError('Could not connect: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  async function handleHost() {
    setBusy(true)
    setError('')
    try {
      const info = await window.api.startHost()
      setHostInfo(info)
      v.setMicBoost(boost)
      await v.join(info.localUrl, micId, noise) // the host connects locally, not through the tunnel
    } catch (e) {
      await window.api.stopHost().catch(() => {})
      setHostInfo(null)
      setError('Could not host: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  function handleLeave() {
    v.leave()
    if (hostInfo) {
      window.api.stopHost().catch(() => {})
      setHostInfo(null)
    }
  }

  async function applyMic(nextId: string, nextNoise: NoiseMode) {
    setMicId(nextId)
    setNoise(nextNoise)
    savePref('micId', nextId)
    savePref('noise', nextNoise)
    if (!v.joined) return
    try {
      setError('')
      await v.changeMic(nextId, nextNoise)
    } catch (e) {
      setError(String(e))
    }
  }

  function applyBoost(n: number): void {
    setBoost(n)
    savePref('boost', String(n))
    v.setMicBoost(n)
  }

  async function handlePick(id: string, quality: ShareQuality) {
    setPicker(false)
    try {
      setError('')
      await v.startShare(id, quality)
    } catch (e) {
      setError(String(e))
    }
  }

  const allScreens = preview && v.localScreen ? { ...v.screens, me: v.localScreen } : v.screens
  const hasScreens = Object.keys(allScreens).length > 0

  return (
    <div className="app">
      <TitleBar />

      {!v.joined ? (
        <ConnectScreen
          onHost={handleHost}
          serverUrl={serverUrl}
          onServerUrl={setServerUrl}
          avatar={avatar}
          onAvatar={changeAvatar}
          name={name}
          onName={changeName}
          error={error}
          busy={busy}
          onJoin={handleJoin}
          onSettings={() => setSettings(true)}
        />
      ) : (
        <div className="body">
          <Sidebar
            server={hostInfo ? hostInfo?.publicUrl : serverUrl}
            hosting={!!hostInfo}
            avatar={avatar}
            avatars={v.avatars}
            myName={name}
            peerIds={v.peerIds}
            names={v.names}
            volumes={v.volumes}
            sharing={Object.keys(v.screens)}
            onVolume={v.setVolume}
          />
          <div className="main">
              {v.sharing && (
                <div className="banner">
                  <span>You are sharing your screen</span>
                  <button onClick={() => setPreview(!preview)}>
                  {preview ? 'Hide preview' : 'Show preview'}
                  </button>
                </div>
              )}
            {error && <div className="err">{error}</div>}
            <ScreenGrid screens={allScreens} names={v.names} />
            <ChatPanel
              chat={v.chat}
              transfers={v.transfers}
              compact={hasScreens}
              onSend={v.sendChat}
              onSendFile={v.sendFile}
              onDismiss={v.dismissTransfer}
            />
          </div>
          <ControlBar
            avatar={avatar}
            name={name}
            muted={v.muted}
            sharing={v.sharing}
            onMute={v.toggleMute}
            onShare={() => setPicker(true)}
            onStopShare={v.stopShare}
            onSettings={() => setSettings(true)}
            onLeave={handleLeave}
          />
        </div>
      )}

      {picker && <ScreenPicker onPick={handlePick} onClose={() => setPicker(false)} />}
      {settings && (
        <SettingsModal
          mics={mics}
          micId={micId}
          noise={noise}
          boost={boost}
          onMic={(id) => applyMic(id, noise)}
          onNoise={(n) => applyMic(micId, n)}
          onBoost={applyBoost}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  )
}