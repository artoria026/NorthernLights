import type { ModuleKey } from '@/lib/tours'

/** Si ya se le mostro el modal de bienvenida de este modulo a este usuario en
 * este navegador -- localStorage a proposito (mismo criterio que
 * getRecentCategoryIcons en categoryIcons.ts: es una preferencia puramente de
 * UX, no vale la pena una tabla/endpoint de backend). El boton de "Recorrido"
 * persistente en el header sigue funcionando sin importar este flag. */
const seenKey = (moduleKey: ModuleKey) => `nl:tour-seen:${moduleKey}`

export function hasSeenTourWelcome(moduleKey: ModuleKey): boolean {
  try {
    return localStorage.getItem(seenKey(moduleKey)) === '1'
  } catch {
    return false
  }
}

export function markTourWelcomeSeen(moduleKey: ModuleKey): void {
  try {
    localStorage.setItem(seenKey(moduleKey), '1')
  } catch {
    // localStorage no disponible (modo privado, etc.) -- no es critico, se ignora
  }
}
