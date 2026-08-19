import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AuthenticatedApp from './AuthenticatedApp'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthenticatedApp />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Core trip data remains available in local storage if registration is blocked.
    })
  })
}
