import { useEffect } from 'react'

/** Ctrl/Cmd+Enter submits the active form without having to tab all the way
 * to the Guardar/Crear button -- same shortcut as Slack/Linear.
 * `target.closest` covers the normal case (focus on a real form
 * input/textarea); the fallback looks for the <form> inside the last
 * visible Dialog because a portaled popup (the category search, any
 * <Select>) lives outside the <form> in the real DOM even though it
 * logically belongs to it -- closest('form') won't find it if focus ended
 * up there. Mounted once in App.tsx. */
export function FormSubmitShortcut() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      const forms = document.querySelectorAll<HTMLFormElement>('[data-slot="dialog-content"] form')
      const form = target?.closest('form') ?? forms[forms.length - 1]
      if (!form) return
      event.preventDefault()
      form.requestSubmit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return null
}
