import { beforeEach, describe, expect, it } from 'vitest'
import { getTourContent } from '@/lib/tours'
import { useTourStore } from './tourStore'

// start() only activates the tour if at least one selector from
// getTourContent('categories').steps exists in the DOM -- see comment in
// tourStore.ts. jsdom starts empty, so every test that needs a
// "startable" tour first mounts a real element for the first step.
function mountFirstCategoriesStepTarget() {
  const selector = getTourContent('categories')!.steps[0].selector
  const attr = selector.match(/data-tour="([^"]+)"/)![1]
  const el = document.createElement('div')
  el.setAttribute('data-tour', attr)
  document.body.appendChild(el)
}

describe('tourStore', () => {
  beforeEach(() => {
    useTourStore.getState().stop()
    document.body.innerHTML = ''
  })

  it('starts idle', () => {
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBeNull()
    expect(state.stepIndex).toBe(0)
  })

  it('start sets the active module and resets the step index', () => {
    mountFirstCategoriesStepTarget()
    useTourStore.getState().setStep(2)
    useTourStore.getState().start('categories')
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBe('categories')
    expect(state.stepIndex).toBe(0)
  })

  it('start does not activate the tour when no step selector exists in the DOM', () => {
    useTourStore.getState().start('categories')
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBeNull()
  })

  it('setStep moves the index without touching the active module', () => {
    mountFirstCategoriesStepTarget()
    useTourStore.getState().start('categories')
    useTourStore.getState().setStep(3)
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBe('categories')
    expect(state.stepIndex).toBe(3)
  })

  it('stop clears both the active module and the step index', () => {
    mountFirstCategoriesStepTarget()
    useTourStore.getState().start('categories')
    useTourStore.getState().setStep(2)
    useTourStore.getState().stop()
    const state = useTourStore.getState()
    expect(state.activeModuleKey).toBeNull()
    expect(state.stepIndex).toBe(0)
  })
})
