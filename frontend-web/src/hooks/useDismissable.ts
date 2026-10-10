import { type RefObject, useEffect } from 'react'

/** Closes a floating panel (popover-style) on an outside press or Escape.
 *
 * Does nothing while a dialog is open: that dialog handles its own dismissal,
 * and closing the panel underneath would unmount whatever opened the dialog
 * (editing a subcategory from inside the panel, a confirm). Presses inside
 * `containerRef` (the card that owns the panel, trigger included) never count
 * as outside. */
export function useDismissable(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return
    const dialogOpen = () => document.querySelector('[role="dialog"]') !== null

    const onPointerDown = (event: PointerEvent) => {
      if (dialogOpen()) return
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogOpen()) onDismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef, active, onDismiss])
}
