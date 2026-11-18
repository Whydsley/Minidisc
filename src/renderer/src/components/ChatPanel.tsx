import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconChevronUp, IconPaperclip, IconSend } from '@tabler/icons-react'
import type { ChatMsg, Transfer } from '../useVoiceRoom'
import { RISKY, colorFor, formatSize } from '../ui'

type Props = {
  chat: ChatMsg[]
  transfers: Transfer[]
  compact: boolean
  onSend: (text: string) => void
  onSendFile: (file: File) => void
  onDismiss: (key: string) => void
}

export default function ChatPanel({ chat, transfers, compact, onSend, onSendFile, onDismiss }: Props) {
  const [draft, setDraft] = useState('')
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView()
  }, [chat.length, hidden])

  function submit(): void {
    onSend(draft)
    setDraft('')
  }

  function pickFiles(e: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setError('')
    for (const f of files) {
      try {
        onSendFile(f)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  return (
    <div className={'chat' + (compact ? ' compact' : '') + (hidden ? ' collapsed' : '')}>
      <div className="chathead">
        <span>Chat</span>
        <button aria-label="Toggle chat" onClick={() => setHidden(!hidden)}>
          {hidden ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>

      {!hidden && (
        <div className="msgs">
          {chat.map((m) =>
            m.system ? (
              <div key={m.key} className="msg sys">{m.text}</div>
            ) : (
              <div key={m.key} className="msg">
                <b style={{ color: m.self ? '#7f8cf5' : colorFor(m.from) }}>{m.from}</b> {m.text}
              </div>
            )
          )}
          {transfers.map((t) => (
            <div key={t.key} className="xfer">
              <span>{t.direction === 'in' ? '⬇' : '⬆'}</span>
              <b>{t.fileName}</b>
              <span className="sm">
                {formatSize(t.size)} {t.direction === 'in' ? 'from' : 'to'} {t.who}
              </span>
              {!t.done && !t.failed && <progress value={t.progress} max={1} />}
              {t.failed && <span className="err">failed</span>}
              {t.done && t.direction === 'out' && <span className="sm">sent</span>}
              {t.done && t.url && (
                <>
                  <a href={t.url} download={t.fileName}>Save</a>
                  {RISKY.test(t.fileName) && (
                    <span className="warn">executable file, open it only if you trust the sender</span>
                  )}
                </>
              )}
              <button aria-label="Dismiss" onClick={() => onDismiss(t.key)}>✕</button>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}

      {error && <div className="err">{error}</div>}
      <div className="inp">
        <button aria-label="Send file" onClick={() => fileInput.current?.click()}>
          <IconPaperclip size={16} />
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={pickFiles} />
        <input
          value={draft}
          maxLength={2000}
          placeholder="Type a message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button aria-label="Send" onClick={submit}>
          <IconSend size={16} />
        </button>
      </div>
    </div>
  )
}