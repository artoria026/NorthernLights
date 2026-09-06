import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import commonEs from '@/locales/es/common.json'
import pagesEs from '@/locales/es/pages.json'
import toursEs from '@/locales/es/tours.json'
import categoriesEs from '@/locales/es/categories.json'
import errorsEs from '@/locales/es/errors.json'
import commonEn from '@/locales/en/common.json'
import pagesEn from '@/locales/en/pages.json'
import toursEn from '@/locales/en/tours.json'
import categoriesEn from '@/locales/en/categories.json'
import errorsEn from '@/locales/en/errors.json'

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

// Same localStorage naming convention as themeStore ('finanzas-theme') /
// authStore ('finanzas-auth'), but read directly by i18next-browser-languagedetector
// instead of through a Zustand store -- changeLanguage() below is the single
// place that updates both i18next's active language and this key.
export const LANGUAGE_STORAGE_KEY = 'finanzas-language'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { common: commonEs, pages: pagesEs, tours: toursEs, categories: categoriesEs, errors: errorsEs },
      en: { common: commonEn, pages: pagesEn, tours: toursEn, categories: categoriesEn, errors: errorsEn },
    },
    ns: ['common', 'pages', 'tours', 'categories', 'errors'],
    defaultNS: 'common',
    // Spanish is the app's original/richer content -- fall back to it for
    // any key not yet translated to English, rather than showing a raw key.
    fallbackLng: 'es',
    supportedLngs: SUPPORTED_LANGUAGES,
    detection: {
      // No saved preference yet -> browser language (navigator) decides;
      // once the user picks one explicitly, localStorage wins from then on.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
    interpolation: {
      escapeValue: false, // React already escapes -- avoid double-escaping
    },
  })

export default i18n
