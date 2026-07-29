import { create } from 'zustand'
import type { ModuleKey } from '@/lib/tours'

interface TourState {
  activeModuleKey: ModuleKey | null
  stepIndex: number
  start: (moduleKey: ModuleKey) => void
  setStep: (index: number) => void
  stop: () => void
}

// Guarda solo el indice, no el contenido de los pasos -- TourHost lee
// TOUR_CONTENT[activeModuleKey] y decide si "Siguiente" avanza o termina.
export const useTourStore = create<TourState>((set) => ({
  activeModuleKey: null,
  stepIndex: 0,
  start: (moduleKey) => set({ activeModuleKey: moduleKey, stepIndex: 0 }),
  setStep: (index) => set({ stepIndex: index }),
  stop: () => set({ activeModuleKey: null, stepIndex: 0 }),
}))
