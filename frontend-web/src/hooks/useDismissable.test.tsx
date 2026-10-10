import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDismissable } from './useDismissable'

function Harness({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismissable(ref, active, onDismiss)
  return (
    <div>
      <div ref={ref} data-testid="card">
        <button>inside</button>
      </div>
      <button data-testid="outside">outside</button>
    </div>
  )
}

describe('useDismissable', () => {
  it('dismisses on a press outside the container', () => {
    const onDismiss = vi.fn()
    const { getByTestId } = render(<Harness active onDismiss={onDismiss} />)
    fireEvent.pointerDown(getByTestId('outside'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss on a press inside the container', () => {
    const onDismiss = vi.fn()
    const { getByText } = render(<Harness active onDismiss={onDismiss} />)
    fireEvent.pointerDown(getByText('inside'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing while inactive (panel closed)', () => {
    const onDismiss = vi.fn()
    const { getByTestId } = render(<Harness active={false} onDismiss={onDismiss} />)
    fireEvent.pointerDown(getByTestId('outside'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('stands aside while a dialog is open: the dialog dismisses itself, not the panel under it', () => {
    const onDismiss = vi.fn()
    const { getByTestId } = render(<Harness active onDismiss={onDismiss} />)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    fireEvent.pointerDown(getByTestId('outside'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()

    dialog.remove()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stops listening once deactivated', () => {
    const onDismiss = vi.fn()
    const { rerender, getByTestId } = render(<Harness active onDismiss={onDismiss} />)
    rerender(<Harness active={false} onDismiss={onDismiss} />)
    fireEvent.pointerDown(getByTestId('outside'))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
