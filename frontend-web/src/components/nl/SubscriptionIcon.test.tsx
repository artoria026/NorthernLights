import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { SubscriptionIcon, SubscriptionIconPicker } from './SubscriptionIcon'

function Harness({ name, initial = null }: { name: string; initial?: string | null }) {
  const [icon, setIcon] = useState<string | null>(initial)
  return (
    <>
      <SubscriptionIconPicker value={icon} name={name} onChange={setIcon} />
      <output data-testid="value">{icon ?? 'auto'}</output>
    </>
  )
}

describe('SubscriptionIcon', () => {
  it('falls back to the first letter when no icon fits the name', () => {
    render(<SubscriptionIcon name="cosa rara" />)
    expect(screen.getByText('C')).toBeTruthy()
  })

  it('draws an icon, not a letter, when the name is a known service', () => {
    const { container } = render(<SubscriptionIcon name="Spotify" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('S')).toBeNull()
  })
})

describe('SubscriptionIconPicker', () => {
  it('starts automatic and picks an icon from the grid', () => {
    render(<Harness name="Algo" />)
    expect(screen.getByTestId('value').textContent).toBe('auto')
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByLabelText('Spotify'))
    expect(screen.getByTestId('value').textContent).toBe('spotify')
  })

  it('narrows the grid with the search and goes back to automatic', () => {
    render(<Harness name="Algo" initial="spotify" />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'netf' } })
    expect(screen.queryByLabelText('Spotify')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.click(screen.getByText(/Automatic|Automático/))
    expect(screen.getByTestId('value').textContent).toBe('auto')
  })
})
