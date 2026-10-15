import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProposalItem, ProposalStatus } from '@/types'
import { ProposalCard } from './ProposalCard'

const tx = (description: string, amount: string, entry_type = 'expense'): ProposalItem => ({
  action: 'create_transaction',
  fields: [
    { key: 'date', value: '2026-10-03' },
    { key: 'description', value: description },
    { key: 'account', value: 'BBVA' },
    { key: 'category', value: 'Comida' },
    { key: 'entry_type', value: entry_type },
    { key: 'amount', value: amount },
  ],
})

const renderCard = (status: ProposalStatus, items: ProposalItem[] = [tx('Tacos', '120')], extra = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<ProposalCard summary="Resumen del asesor" items={items} status={status} onConfirm={onConfirm} onCancel={onCancel} {...extra} />)
  return { onConfirm, onCancel }
}

describe('ProposalCard', () => {
  it('lists every movement in a table with totals, and offers confirm / cancel while pending', () => {
    const { onConfirm, onCancel } = renderCard('pending', [tx('Tacos', '120'), tx('Café', '40'), tx('Nómina', '5000', 'income')])
    expect(screen.getByText('Revisa antes de registrar')).toBeInTheDocument()
    expect(screen.getByText('Resumen del asesor')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.getByText('3 movimientos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('locks both buttons while the server works', () => {
    renderCard('pending', undefined, { busy: 'confirm' })
    expect(screen.getByRole('button', { name: /Confirmar y registrar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Cancelar/ })).toBeDisabled()
  })

  it.each([
    ['confirmed', 'Registrado'],
    ['cancelled', 'Cancelada: no se registró nada'],
    ['failed', 'No se pudo registrar: no se guardó nada'],
    ['expired', 'Expiró: no se registró nada'],
  ] as const)('once %s it keeps the outcome and no buttons', (status, label) => {
    renderCard(status)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows why it failed', () => {
    renderCard('failed', undefined, { error: 'La cuenta ya no existe' })
    expect(screen.getByText('La cuenta ya no existe')).toBeInTheDocument()
    expect(screen.getByText('Pídele al asesor que lo corrija y te lo proponga de nuevo.')).toBeInTheDocument()
  })

  it('shows accounts, debts and the rest as labelled fields, in the UI language', () => {
    renderCard('pending', [
      {
        action: 'create_debt',
        fields: [
          { key: 'name', value: 'Tarjeta' },
          { key: 'total_amount', value: '8000' },
          { key: 'interest_rate', value: '0.35' },
        ],
      },
    ])
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('35%')).toBeInTheDocument()
    expect(screen.getByText('Tarjeta')).toBeInTheDocument()
  })
})
