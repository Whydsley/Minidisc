export function log(source: string, message: string): void {
  try {
    window.api.log(source, message)
  } catch {
    /* not critical */
  }
}