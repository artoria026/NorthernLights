import { create } from 'zustand'
import { getTourContent, type ModuleKey, type TourStepContent } from '@/lib/tours'

interface TourState {
  activeModuleKey: ModuleKey | null
  stepIndex: number
  /** Subset of getTourContent(moduleKey).steps whose selector existed in the
   * DOM at the moment the tour started -- several steps are conditional
   * (banners, charts that only appear with data, etc.), so they're filtered
   * once here instead of TourHost silently aborting the entire tour
   * the first time a selector doesn't appear. */
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
    const steps = getTourContent(moduleKey)?.steps ?? []
    const visibleSteps = steps.filter((step) => document.querySelector(step.selector))
    if (visibleSteps.length === 0) return
    set({ activeModuleKey: moduleKey, stepIndex: 0, visibleSteps })
  },
  setStep: (index) => set({ stepIndex: index }),
  stop: () => set({ activeModuleKey: null, stepIndex: 0, visibleSteps: [] }),
}))
