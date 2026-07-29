import { beforeEach, describe, expect, it } from 'vitest'
import { useTourStore } from './tourStore'

describe('tourStore', () => {
  beforeEach(() => {
    useTourStore.getState().stop()
  })

  it('starts idle', () => {
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBeNull()
    expect(state.stepIndex).toBe(0)
  })

  it('start sets the active module and resets the step index', () => {
    useTourStore.getState().setStep(2)
    useTourStore.getState().start('categories')
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBe('categories')
    expect(state.stepIndex).toBe(0)
  })

  it('setStep moves the index without touching the active module', () => {
    useTourStore.getState().start('categories')
    useTourStore.getState().setStep(3)
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBe('categories')
    expect(state.stepIndex).toBe(3)
  })

  it('stop clears both the active module and the step index', () => {
    useTourStore.getState().start('categories')
    useTourStore.getState().setStep(2)
    useTourStore.getState().stop()
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBeNull()
    expect(state.stepIndex).toBe(0)
  })
})
