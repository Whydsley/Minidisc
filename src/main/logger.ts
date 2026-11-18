import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

let file = ''

export function logFilePath(): string {
  if (!file) {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'minidisc.log')
  }
  return file
}

export function writeLog(source: string, message: string): void {
  try {
    const f = logFilePath()
    if (existsSync(f) && statSync(f).size > 2 * 1024 * 1024) renameSync(f, f + '.old')
    appendFileSync(f, `${new Date().toISOString()} [${source}] ${message.slice(0, 2000)}\n`)
  } catch {
    /* logging must never crash the app */
  }
}