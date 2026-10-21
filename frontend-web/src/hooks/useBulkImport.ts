import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export interface BulkImportError {
  row: number
  block: string | null
  reason: string
}

export interface BulkImportPreview {
  valid_rows: number
  error_rows: number
  income: { count: number; total: string }
  expense: { count: number; total: string }
  card_payment: { count: number; total: string }
  /** People's debts in the file: loans, repayments and opening balances. */
  debts: {
    loans: { count: number; total: string }
    payments: { count: number; total: string }
    openings: { count: number; total: string }
    people: number
  }
  date_from: string | null
  date_to: string | null
  by_account: { name: string; count: number; income: string; expense: string }[]
  by_category: { name: string; type: 'income' | 'expense'; count: number; total: string }[]
  by_tag: { name: string; count: number; total: string }[]
  possible_duplicates: {
    count: number
    examples: { row: number; date: string; amount: string; description: string }[]
  }
  errors: BulkImportError[]
}

export interface BulkImportResult {
  created: number
  errors: BulkImportError[]
}

export function useDownloadTemplate() {
  return useMutation({
    mutationFn: async () => {
      const response = await api.get('/bulk-import/template', { responseType: 'blob' })
      const url = URL.createObjectURL(response.data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'plantilla_transacciones.xlsx'
      link.click()
      URL.revokeObjectURL(url)
    },
  })
}

/** Reads the file and says what loading it would do. Nothing is saved. */
export function usePreviewBulkImport() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post<ApiSuccess<BulkImportPreview>>('/bulk-import/preview', formData)
      return data.data
    },
  })
}

export function useUploadBulkImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post<ApiSuccess<BulkImportResult>>(
        '/bulk-import/upload',
        formData,
      )
      return data.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['debts'] })
    },
  })
}
