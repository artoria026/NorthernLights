import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/i18n'
import App from './App.tsx'
import {
  otherTabsAlive,
  readLastAlive,
  setLogoutReason,
  shouldEndSessionOnBoot,
  startLiveness,
} from './lib/sessionTimeout'
import { useAuthStore } from './stores/authStore'

/** Closing the app and opening it again asks for the login again (a reload or a
 * second tab doesn't). Decided before anything renders, and before this page
 * starts counting as "alive" itself. */
async function boot() {
  const hasSession = !!useAuthStore.getState().accessToken
  if (
    shouldEndSessionOnBoot({
      hasSession,
      now: Date.now(),
      lastAliveAt: readLastAlive(),
      otherTabsAlive: hasSession ? await otherTabsAlive() : false,
    })
  ) {
    setLogoutReason('restart')
    useAuthStore.getState().logout()
  }
  startLiveness()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
