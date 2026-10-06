import { useTranslation } from 'react-i18next'
import { ImportJsonButton } from '@/components/nl/ImportJsonButton'
import { useImportCategories } from '@/hooks/useCategories'
import { apiErrorMessage } from '@/services/api'
import { useUiStore } from '@/stores/uiStore'

/** File picker for a categories JSON export (see useExportCategories). */
export function ImportCategoriesButton({ className }: { className: string }) {
  const { t } = useTranslation('pages')
  const importCategories = useImportCategories()
  const pushToast = useUiStore((s) => s.pushToast)

  return (
    <ImportJsonButton
      className={className}
      label={t('categories.import.button')}
      pendingLabel={t('categories.import.importing')}
      pending={importCategories.isPending}
      onFile={(file) =>
        importCategories.mutate(file, {
          onSuccess: ({ created, hidden, skipped, unmatched }) => {
            const summary = t('categories.import.done', { created, hidden })
            const notes = [
              skipped.length > 0 && t('categories.import.skipped', { count: skipped.length }),
              unmatched.length > 0 &&
                t('categories.import.unmatched', { count: unmatched.length, list: unmatched.join(', ') }),
            ].filter(Boolean)
            pushToast([summary, ...notes].join(' '), unmatched.length > 0 ? 'error' : 'success')
          },
          onError: (err) =>
            pushToast(
              err instanceof SyntaxError ? t('categories.import.invalidFile') : apiErrorMessage(err),
              'error',
            ),
        })
      }
    />
  )
}
