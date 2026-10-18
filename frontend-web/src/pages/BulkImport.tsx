import { Check, Download, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BulkImportSummary } from '@/components/nl/BulkImportSummary'
import { DialogCancelButton, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { FileDropZone } from '@/components/nl/FileDropZone'
import { HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'
import {
  type BulkImportPreview,
  type BulkImportResult,
  useDownloadTemplate,
  usePreviewBulkImport,
  useUploadBulkImport,
} from '@/hooks/useBulkImport'
import { apiErrorMessage } from '@/services/api'

type Step =
  | { name: 'pick' }
  | { name: 'preview'; file: File; preview: BulkImportPreview }
  | { name: 'done'; fileName: string; result: BulkImportResult }

/** Bulk load from an Excel file, in three steps: pick the file (drop it here), read
 * the summary of what it would do -- nothing is saved yet -- and confirm. */
export function BulkImport() {
  const { t } = useTranslation('pages')
  const downloadTemplate = useDownloadTemplate()
  const previewFile = usePreviewBulkImport()
  const uploadFile = useUploadBulkImport()
  const [step, setStep] = useState<Step>({ name: 'pick' })

  function reset() {
    previewFile.reset()
    uploadFile.reset()
    setStep({ name: 'pick' })
  }

  function handleFile(file: File) {
    uploadFile.reset()
    previewFile.mutate(file, { onSuccess: (preview) => setStep({ name: 'preview', file, preview }) })
  }

  function confirm(file: File) {
    uploadFile.mutate(file, {
      onSuccess: (result) => setStep({ name: 'done', fileName: file.name, result }),
    })
  }

  return (
    <div>
      <ViewHeader
        icon={<FileSpreadsheet />}
        title={t('bulkImport.title')}
        subtitle={t('bulkImport.subtitle')}
        section={HEADER_SECTIONS.diario}
      />

      <div className="flex w-full flex-col gap-4">
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-1 text-[14px] font-semibold">{t('bulkImport.templateTitle')}</h2>
          <p className="mb-3 text-[12.5px] text-muted-foreground">{t('bulkImport.templateBody')}</p>
          <button
            type="button"
            onClick={() => downloadTemplate.mutate()}
            disabled={downloadTemplate.isPending}
            className="flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Download size={14} />
            {downloadTemplate.isPending ? t('bulkImport.generating') : t('bulkImport.downloadTemplate')}
          </button>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          {step.name === 'pick' && (
            <>
              <h2 className="mb-3 text-[14px] font-semibold">{t('bulkImport.dropTitle')}</h2>
              <FileDropZone
                accept=".xlsx"
                acceptedExtensions={['.xlsx']}
                disabled={previewFile.isPending}
                title={previewFile.isPending ? t('bulkImport.reading') : t('bulkImport.dropHere')}
                hint={t('bulkImport.dropHint')}
                rejectedMessage={t('bulkImport.onlyXlsx')}
                onFile={handleFile}
              />
              {previewFile.isError && (
                <p className="mt-2 text-sm text-destructive">{apiErrorMessage(previewFile.error)}</p>
              )}
            </>
          )}

          {step.name === 'preview' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold">{t('bulkImport.summaryTitle')}</h2>
                <span className="truncate text-xs text-muted-foreground">{step.file.name}</span>
              </div>
              <BulkImportSummary preview={step.preview} />
              {uploadFile.isError && (
                <p className="text-sm text-destructive">{apiErrorMessage(uploadFile.error)}</p>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <DialogPrimaryButton
                  type="button"
                  icon={Check}
                  onClick={() => confirm(step.file)}
                  pending={uploadFile.isPending}
                  pendingLabel={t('bulkImport.loading')}
                  disabled={step.preview.valid_rows === 0}
                >
                  {t('bulkImport.confirm', { count: step.preview.valid_rows })}
                </DialogPrimaryButton>
                <DialogCancelButton onClick={reset} disabled={uploadFile.isPending} className="disabled:opacity-50">
                  <RotateCcw size={14} />
                  {t('bulkImport.chooseAnother')}
                </DialogCancelButton>
              </div>
              <p className="text-[11.5px] text-muted-foreground">{t('bulkImport.noUndo')}</p>
            </div>
          )}

          {step.name === 'done' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--nl-accent-ink)' }}>
                {t('bulkImport.done', { count: step.result.created })}
              </p>
              <p className="text-xs text-muted-foreground">{step.fileName}</p>
              {step.result.errors.length > 0 && (
                <div className="text-[12.5px]">
                  <p className="mb-1 font-semibold" style={{ color: 'var(--nl-danger-ink)' }}>
                    {t('bulkImport.summary.errorsTitle', { count: step.result.errors.length })}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {step.result.errors.map((e, i) => (
                      <li key={i}>
                        {t('bulkImport.summary.row', { row: e.row })}
                        {e.block ? ` (${e.block})` : ''}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <DialogPrimaryButton type="button" icon={Upload} onClick={reset}>
                  {t('bulkImport.loadAnother')}
                </DialogPrimaryButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
