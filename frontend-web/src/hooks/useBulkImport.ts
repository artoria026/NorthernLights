import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export interface BulkImportError {
  row: number
  block: string | null
  reason: string
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
    },
  })
}
