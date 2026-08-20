import { create } from 'zustand'
import { TOUR_CONTENT, type ModuleKey, type TourStepContent } from '@/lib/tours'

interface TourState {
  activeModuleKey: ModuleKey | null
  stepIndex: number
  /** Subconjunto de TOUR_CONTENT[moduleKey].steps cuyo selector existia en el
   * DOM al momento de iniciar el recorrido -- varios pasos son condicionales
   * (banners, gaficas que solo aparecen con datos, etc.), asi que se filtran
   * una sola vez aqui en vez de que TourHost aborte todo el recorrido en
   * silencio la primera vez que un selector no aparece. */
  visibleSteps: TourStepContent[]
  start: (moduleKey: ModuleKey) => void
  setStep: (index: number) => void
  stop: () => void
}

export const useTourStore = create<TourState>((set) => ({
  activeModuleKey: null,
  stepIndex: 0,
  visibleSteps: [],
  start: (moduleKey) => {
    const steps = TOUR_CONTENT[moduleKey]?.steps ?? []
    const visibleSteps = steps.filter((step) => document.querySelector(step.selector))
    if (visibleSteps.length === 0) return
    set({ activeModuleKey: moduleKey, stepIndex: 0, visibleSteps })
  },
  setStep: (index) => set({ stepIndex: index }),
  stop: () => set({ activeModuleKey: null, stepIndex: 0, visibleSteps: [] }),
}))
