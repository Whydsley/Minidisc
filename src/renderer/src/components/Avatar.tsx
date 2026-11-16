import { colorFor, initial } from '../ui'

type Props = { name: string; src?: string; size?: number }

export default function Avatar({ name, src, size = 28 }: Props) {
  return (
    <span
      className="av"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.43 }}
    >
      {src ? <img src={src} alt="" /> : initial(name)}
    </span>
  )
}