import { useEffect } from 'react'

/** Ctrl/Cmd+Enter envia el formulario activo sin tener que tabular hasta el
 * botón de Guardar/Crear -- mismo atajo que Slack/Linear. `target.closest`
 * cubre el caso normal (foco en un input/textarea real del formulario); el
 * fallback busca el <form> dentro del último Dialog visible porque un popup
 * portaleado (el buscador de categoría, cualquier <Select>) vive fuera del
 * <form> en el DOM real aunque logicamente pertenezca a él -- closest('form')
 * no lo encuentra si el foco quedó ahí. Montado una sola vez en App.tsx. */
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
