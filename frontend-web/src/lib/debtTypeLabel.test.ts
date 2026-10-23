import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { debtTypeLabel } from './utils'

const TYPES = ['personal_loan', 'payroll_loan', 'informal', 'civic', 'loan_received', 'credit']

describe('debtTypeLabel', () => {
  afterEach(async () => {
    await i18n.changeLanguage('es')
  })

  it('names the credit type in Spanish and English', async () => {
    expect(debtTypeLabel('credit')).toBe('Crédito')
    await i18n.changeLanguage('en')
    expect(debtTypeLabel('credit')).toBe('Credit')
  })

  it('has a translated label for every debt type in both languages', async () => {
    for (const lang of ['es', 'en']) {
      await i18n.changeLanguage(lang)
      for (const type of TYPES) expect(debtTypeLabel(type)).not.toBe(type)
    }
  })
})
