import i18n from './i18n'

/** Reusable prompt for the user to paste into ANOTHER AI (ChatGPT, Gemini,
 * etc. -- the conversation where they already keep an informal record of
 * their finances) and bring back a summary in the format the AI Advisor
 * expects for importing it. `categoryNames` are the user's categories as the
 * API returns them (system ones already in their language; the advisor accepts
 * either language anyway). Used to live in ImportarDatos.tsx before that
 * screen was consolidated into AI Advisor. */
export function getExportPrompt(categoryNames: string[]): string {
  return i18n.t('importPrompt.template', {
    ns: 'common',
    categories: categoryNames.join(', '),
  })
}
