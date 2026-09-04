import { useEffect } from 'react'
import { useUiStore, type Toast } from '@/stores/uiStore'

/** Success reads fast and doesn't need to stay on screen; an error usually
 * carries more text (comes from apiErrorMessage) and it's worth giving it
 * more time before it goes away on its own. Either one can still be
 * dismissed with a click before the time is up. */
const AUTO_DISMISS_MS: Record<Toast['variant'], number> = {
  success: 4000,
  error: 6000,
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS[toast.variant])
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id])

  return (
    <button
      onClick={onDismiss}
      className={`rounded-md px-4 py-2 text-sm text-white shadow-lg text-left ${
        toast.variant === 'error' ? 'bg-red-600' : 'bg-emerald-600'
      }`}
    >
      {toast.message}
    </button>
  )
}

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts)
  const dismissToast = useUiStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  )
}
