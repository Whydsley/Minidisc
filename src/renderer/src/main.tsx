import './styles.css'
import { log } from './log'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

window.addEventListener('error', (e) => log('error', `${e.message} (${e.filename}:${e.lineno})`))
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled: ${String(e.reason)}`))
log('app', navigator.userAgent)
