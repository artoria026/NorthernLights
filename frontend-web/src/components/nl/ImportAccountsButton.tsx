import { useTranslation } from 'react-i18next'
import { ImportJsonButton } from '@/components/nl/ImportJsonButton'
import { useImportAccounts } from '@/hooks/useAccounts'
import { apiErrorMessage } from '@/services/api'
import { useUiStore } from '@/stores/uiStore'

/** File picker for an accounts JSON export (see useExportAccounts). */
export function ImportAccountsButton({ className }: { className: string }) {
  const { t } = useTranslation('pages')
  const importAccounts = useImportAccounts()
  const pushToast = useUiStore((s) => s.pushToast)

  return (
    <ImportJsonButton
      className={className}
      label={t('accounts.import.button')}
      pendingLabel={t('accounts.import.importing')}
      pending={importAccounts.isPending}
      onFile={(file) =>
        importAccounts.mutate(file, {
          onSuccess: ({ created, skipped }) =>
            pushToast(
              skipped.length > 0
                ? t('accounts.import.doneWithSkipped', { count: created, skipped: skipped.length })
                : t('accounts.import.done', { count: created }),
              'success',
            ),
          onError: (err) =>
            pushToast(
              err instanceof SyntaxError ? t('accounts.import.invalidFile') : apiErrorMessage(err),
              'error',
            ),
        })
      }
    />
  )
}
