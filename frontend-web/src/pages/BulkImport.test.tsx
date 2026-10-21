import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkImportPreview, BulkImportResult } from '@/hooks/useBulkImport'
import { AUTO_RESET_MS, BulkImport } from './BulkImport'

const preview: BulkImportPreview = {
  valid_rows: 3,
  error_rows: 1,
  income: { count: 1, total: '1000.00' },
  expense: { count: 2, total: '150.00' },
  card_payment: { count: 0, total: '0' },
  debts: {
    loans: { count: 0, total: '0' },
    payments: { count: 0, total: '0' },
    openings: { count: 0, total: '0' },
    people: 0,
  },
  date_from: '2026-10-01',
  date_to: '2026-10-13',
  by_account: [{ name: 'Santander', count: 3, income: '1000.00', expense: '150.00' }],
  by_category: [
    { name: 'Empleo principal', type: 'income', count: 1, total: '1000.00' },
    { name: 'Gasolina', type: 'expense', count: 2, total: '150.00' },
  ],
  by_tag: [{ name: 'Viaje Mty', count: 2, total: '150.00' }],
  possible_duplicates: {
    count: 1,
    examples: [{ row: 4, date: '2026-10-12', amount: '100.00', description: 'Cena' }],
  },
  errors: [{ row: 6, block: 'Gasto', reason: "La cuenta 'NoExiste' no existe" }],
}

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  uploadMutate: vi.fn(),
  uploadPending: false,
}))

vi.mock('@/hooks/useBulkImport', () => ({
  useDownloadTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewBulkImport: () => ({ mutate: mocks.previewMutate, reset: vi.fn(), isPending: false, isError: false }),
  useUploadBulkImport: () => ({
    mutate: mocks.uploadMutate,
    reset: vi.fn(),
    isPending: mocks.uploadPending,
    isError: false,
  }),
}))

const xlsx = new File(['x'], 'lote.xlsx')

function renderPage() {
  return render(
    <MemoryRouter>
      <BulkImport />
    </MemoryRouter>,
  )
}

async function dropFile() {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files: [xlsx] } })
  await screen.findByTestId('bulk-summary')
}

beforeEach(() => {
  mocks.previewMutate.mockReset()
  mocks.uploadMutate.mockReset()
  mocks.uploadPending = false
  mocks.previewMutate.mockImplementation((_file: File, options?: { onSuccess?: (p: BulkImportPreview) => void }) =>
    options?.onSuccess?.(preview),
  )
})

describe('BulkImport', () => {
  it('shows a summary of the file before saving anything', async () => {
    renderPage()
    await dropFile()
    expect(screen.getByText('3 movimientos listos para cargar')).toBeInTheDocument()
    expect(screen.getByText('Santander', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Viaje Mty', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('2026-10-01 → 2026-10-13')).toBeInTheDocument()
    expect(mocks.uploadMutate).not.toHaveBeenCalled()
  })

  it('shows card payments apart, only when the file has them', async () => {
    renderPage()
    await dropFile()
    expect(screen.queryByText('Pagos de tarjeta')).not.toBeInTheDocument()

    mocks.previewMutate.mockImplementation((_f: File, options?: { onSuccess?: (p: BulkImportPreview) => void }) =>
      options?.onSuccess?.({ ...preview, card_payment: { count: 2, total: '390.00' } }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro archivo' }))
    await dropFile()
    expect(screen.getByText('Pagos de tarjeta')).toBeInTheDocument()
    expect(screen.getByText('$390.00')).toBeInTheDocument()
  })

  it('shows the people debts of the file apart, only when it has them', async () => {
    renderPage()
    await dropFile()
    expect(screen.queryByTestId('bulk-debts')).not.toBeInTheDocument()

    mocks.previewMutate.mockImplementation((_f: File, options?: { onSuccess?: (p: BulkImportPreview) => void }) =>
      options?.onSuccess?.({
        ...preview,
        debts: {
          loans: { count: 2, total: '1500.00' },
          payments: { count: 1, total: '300.00' },
          openings: { count: 1, total: '15000.00' },
          people: 2,
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro archivo' }))
    await dropFile()
    const debts = screen.getByTestId('bulk-debts')
    expect(debts).toHaveTextContent('Deudas')
    expect(debts).toHaveTextContent('2 personas')
    expect(debts).toHaveTextContent('Préstamos')
    expect(debts).toHaveTextContent('$1,500.00')
    expect(debts).toHaveTextContent('Abonos')
    expect(debts).toHaveTextContent('$300.00')
    expect(debts).toHaveTextContent('Saldos iniciales')
    expect(debts).toHaveTextContent('$15,000.00')
  })

  it('warns about rows that look already loaded and lists the rows with problems', async () => {
    renderPage()
    await dropFile()
    expect(screen.getByText('1 fila parece ya cargada')).toBeInTheDocument()
    expect(screen.getByText('1 fila con problemas (no se cargará)')).toBeInTheDocument()
    expect(screen.getByText(/La cuenta 'NoExiste' no existe/)).toBeInTheDocument()
  })

  it('loads only when confirmed, and then says how many were recorded', async () => {
    const result: BulkImportResult = { created: 3, errors: [] }
    mocks.uploadMutate.mockImplementation((_file: File, options?: { onSuccess?: (r: BulkImportResult) => void }) =>
      options?.onSuccess?.(result),
    )
    renderPage()
    await dropFile()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y cargar 3 movimientos' }))
    await waitFor(() => expect(mocks.uploadMutate).toHaveBeenCalledWith(xlsx, expect.anything()))
    expect(await screen.findByText('Se registraron 3 movimientos.')).toBeInTheDocument()
  })

  describe('after a load', () => {
    async function loadWith(result: BulkImportResult) {
      mocks.uploadMutate.mockImplementation((_file: File, options?: { onSuccess?: (r: BulkImportResult) => void }) =>
        options?.onSuccess?.(result),
      )
      renderPage()
      await dropFile()
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar y cargar 3 movimientos' }))
      await screen.findByText(/Se registraron/)
    }

    it('clears the summary by itself after 15 seconds, ready for the next file', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await loadWith({ created: 3, errors: [] })
        act(() => {
          vi.advanceTimersByTime(AUTO_RESET_MS - 1000)
        })
        expect(screen.getByText('Se registraron 3 movimientos.')).toBeInTheDocument()
        act(() => {
          vi.advanceTimersByTime(1500)
        })
        expect(screen.queryByText('Se registraron 3 movimientos.')).not.toBeInTheDocument()
        expect(screen.getByTestId('file-input')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps the summary when some rows were rejected, so they can be read', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await loadWith({ created: 2, errors: [{ row: 5, block: 'Gasto', reason: 'La cuenta no existe' }] })
        act(() => {
          vi.advanceTimersByTime(AUTO_RESET_MS * 4)
        })
        expect(screen.getByText('Se registraron 2 movimientos.')).toBeInTheDocument()
        expect(screen.getByText(/La cuenta no existe/)).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('lets the user pick another file instead of confirming', async () => {
    renderPage()
    await dropFile()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir otro archivo' }))
    expect(screen.getByTestId('file-input')).toBeInTheDocument()
    expect(mocks.uploadMutate).not.toHaveBeenCalled()
  })

  it('cannot confirm a file with nothing valid in it', async () => {
    mocks.previewMutate.mockImplementation((_f: File, options?: { onSuccess?: (p: BulkImportPreview) => void }) =>
      options?.onSuccess?.({ ...preview, valid_rows: 0, possible_duplicates: { count: 0, examples: [] } }),
    )
    renderPage()
    await dropFile()
    expect(screen.getByRole('button', { name: /Confirmar y cargar/ })).toBeDisabled()
  })
})
