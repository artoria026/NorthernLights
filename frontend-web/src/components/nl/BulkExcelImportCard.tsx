import { Download, Upload } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { useDownloadTemplate, useUploadBulkImport } from '@/hooks/useBulkImport'
import { apiErrorMessage } from '@/services/api'

/** Carga masiva vía Excel -- vivía en ImportarDatos.tsx antes de que esa
 * pantalla se consolidara dentro de Asesor IA. A diferencia del chat, esto
 * es upload real (multipart) sin IA de por medio: cada fila válida se
 * registra directo, sin paso de confirmación. */
export function BulkExcelImportCard() {
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
      <p className="text-sm text-muted-foreground mb-4">
        ¿Llevas días sin registrar nada pero tienes todo anotado de forma burda? Descarga la plantilla,
        llénala (ya trae tus cuentas y categorías como listas desplegables) y súbela.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => downloadTemplate.mutate()}
          disabled={downloadTemplate.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Download size={14} />
          {downloadTemplate.isPending ? 'Generando...' : 'Descargar plantilla'}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadFile.isPending}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm disabled:opacity-50"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <Upload size={14} />
          {uploadFile.isPending ? 'Cargando...' : 'Cargar archivo'}
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
        <p className="text-xs text-muted-foreground mb-2">Último archivo: {fileName}</p>
      )}

      {uploadFile.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(uploadFile.error)}</p>
      )}

      {result && (
        <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-border">
          <p className="text-sm" style={{ color: 'var(--nl-accent-ink)' }}>
            Se registraron {result.created} movimiento{result.created === 1 ? '' : 's'}.
          </p>
          {result.errors.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {result.errors.length} fila{result.errors.length === 1 ? '' : 's'} con problemas:
              </p>
              <ul className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">
                    Fila {e.row}
                    {e.block ? ` (${e.block})` : ''}: {e.reason}
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
