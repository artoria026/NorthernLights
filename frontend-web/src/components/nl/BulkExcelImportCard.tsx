import { Download, Upload } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDownloadTemplate, useUploadBulkImport } from '@/hooks/useBulkImport'
import { apiErrorMessage } from '@/services/api'

/** Bulk import via Excel -- used to live in ImportarDatos.tsx before that
 * screen was consolidated into Asesor IA. Unlike the chat, this is a real
 * upload (multipart) with no AI in between: every valid row gets recorded
 * directly, with no confirmation step. */
export function BulkExcelImportCard() {
  const { t } = useTranslation('common')
  const downloadTemplate = useDownloadTemplate()
  const uploadFile = useUploadBulkImport()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    uploadFile.mutate(file, {
      onSettled: () => {
        if (fileInputRef.current) fileInputRef.current.value = ''
      },
    })
  }

  const result = uploadFile.data

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">{t('bulkExcelImportCard.intro')}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => downloadTemplate.mutate()}
          disabled={downloadTemplate.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Download size={14} />
          {downloadTemplate.isPending
            ? t('bulkExcelImportCard.generatingButton')
            : t('bulkExcelImportCard.downloadTemplateButton')}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadFile.isPending}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm disabled:opacity-50"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <Upload size={14} />
          {uploadFile.isPending
            ? t('bulkExcelImportCard.uploadingButton')
            : t('bulkExcelImportCard.uploadFileButton')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {fileName && !uploadFile.isPending && (
        <p className="text-xs text-muted-foreground mb-2">
          {t('bulkExcelImportCard.lastFile', { fileName })}
        </p>
      )}

      {uploadFile.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(uploadFile.error)}</p>
      )}

      {result && (
        <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-border">
          <p className="text-sm" style={{ color: 'var(--nl-accent-ink)' }}>
            {t('bulkExcelImportCard.resultSummary', { count: result.created })}
          </p>
          {result.errors.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {t('bulkExcelImportCard.errorSummary', { count: result.errors.length })}
              </p>
              <ul className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">
                    {t('bulkExcelImportCard.errorRow', {
                      row: e.row,
                      block: e.block ? ` (${e.block})` : '',
                      reason: e.reason,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
