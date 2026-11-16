const COLORS = ['#5b6bf0', '#1d9e75', '#d85a30', '#d4537e', '#378add', '#ba7517', '#7f77dd']

export function colorFor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const RISKY = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|lnk|dll|reg)$/i

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem('minidisc:' + key) ?? fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem('minidisc:' + key, value)
  } catch {
    /* not critical */
  }
}

export function normalizeServerUrl(input: string): string | null {
  let value = input.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/.test(value)
    value = (local ? 'http://' : 'https://') + value
  }
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

export function isSafeAvatar(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 60_000 && AVATAR_RE.test(v)
}

export async function resizeImage(file: File, size = 128): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file')
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const side = Math.min(bmp.width, bmp.height) // centered square crop
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  bmp.close()
  const url = canvas.toDataURL('image/jpeg', 0.82)
  if (!isSafeAvatar(url)) throw new Error('Image is too large')
  return url
}