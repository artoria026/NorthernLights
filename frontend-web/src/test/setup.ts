import '@testing-library/jest-dom/vitest'
import i18n from '@/lib/i18n'

// jsdom's navigator.language doesn't reflect a real user's browser, so the
// language detector would otherwise pick an arbitrary default -- tests
// assert against the original Spanish copy, so pin it here for determinism.
void i18n.changeLanguage('es')
