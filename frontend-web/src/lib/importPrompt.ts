import i18n from './i18n'

/** Real system category names (see backend migration 293528f67338) --
 * embedded once here and interpolated into the prompt template below,
 * instead of hardcoding the list a second time inside each locale's
 * translated string. These names are what the bulk-import matching in
 * bulk_import_service.py compares against verbatim, so they stay in
 * Spanish regardless of the active UI language (see Phase 14: category
 * *display* names are translated in the frontend via a slug lookup, but
 * the underlying stored/matched name is always this list). */
const SYSTEM_CATEGORY_NAMES = [
  'Comida y Bebidas',
  'Transporte y Movilidad',
  'Vivienda y Hogar',
  'Salud y Bienestar',
  'Ropa y Cuidado Personal',
  'Ocio y Entretenimiento',
  'Educación y Desarrollo',
  'Mascotas',
  'Otro Gasto',
  'Empleo principal',
  'Freelance',
  'Otro',
]

/** Reusable prompt for the user to paste into ANOTHER AI (ChatGPT, Gemini,
 * etc. -- the conversation where they already keep an informal record of
 * their finances) and bring back a summary in the format the AI Advisor
 * expects for importing it. Used to live in ImportarDatos.tsx before that
 * screen was consolidated into AI Advisor. */
export function getExportPrompt(): string {
  return i18n.t('importPrompt.template', {
    ns: 'common',
    categories: SYSTEM_CATEGORY_NAMES.join(', '),
  })
}
