import Avatar from './Avatar'
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconScreenShare,
  IconScreenShareOff,
  IconSettings
} from '@tabler/icons-react'

type Props = {
  name: string
  avatar: string
  muted: boolean
  sharing: boolean
  onMute: () => void
  onShare: () => void
  onStopShare: () => void
  onSettings: () => void
  onLeave: () => void
}

export default function ControlBar(p: Props) {
  return (
    <div className="bar">
      <Avatar name={p.name} src={p.avatar} />
      <div className="who">
        <span>{p.name}</span>
        <span className="sm">{p.muted ? 'Muted' : 'Connected'}</span>
      </div>
      <button className={'cb' + (p.muted ? ' off' : '')} aria-label="Mute" onClick={p.onMute}>
        {p.muted ? <IconMicrophoneOff size={18} /> : <IconMicrophone size={18} />}
      </button>
      <button
        className={'cb' + (p.sharing ? ' off' : '')}
        aria-label={p.sharing ? 'Stop sharing' : 'Share screen'}
        onClick={p.sharing ? p.onStopShare : p.onShare}
      >
        {p.sharing ? <IconScreenShareOff size={18} /> : <IconScreenShare size={18} />}
      </button>
      <button className="cb" aria-label="Settings" onClick={p.onSettings}>
        <IconSettings size={18} />
      </button>
      <button className="cb off" aria-label="Leave" onClick={p.onLeave}>
        <IconPhoneOff size={18} />
      </button>
    </div>
  )
}