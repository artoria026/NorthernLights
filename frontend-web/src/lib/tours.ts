/** Content registry for the guided tour (Welcome + focus tour,
 * "Proposal 5" -- see recorridos-propuestas.html at the repo root, which
 * tested the visual mechanics before it was ported here). One entry per
 * module; modules that don't have an entry yet simply don't show the tour
 * button or the welcome modal (see ViewHeader in primitives.tsx) -- so the
 * rollout is incremental without touching types.
 *
 * Several `steps` are conditional (banners, charts that only appear with
 * data, buttons behind a Settings toggle) -- tourStore filters out, when
 * starting the tour, the ones that have no selector in the DOM at that
 * moment, so a user without that data still sees a complete tour, just
 * shorter. That's why NO step here may live inside the content of a closed
 * Dialog/modal -- that selector never exists until the user opens the
 * dialog by hand, and the step would always be left out of the tour. Only
 * trigger buttons (DialogTrigger) or content that's already on screen get
 * anchored. Anything that only lives inside a form (e.g. the "interest-free
 * installments" checkbox in New transaction) is explained as text inside a
 * neighboring step that does have a real anchor.
 *
 * Translatable content (welcome.description, welcome.bullets, steps[].title,
 * steps[].text) lives in locales/{es,en}/tours.json under the `tours`
 * namespace, one top-level key per module. Only the `selector` values below
 * stay here: they're DOM CSS selectors, not translatable text, and the JSON
 * `steps` arrays must stay in this exact order since getTourContent() zips
 * them together by index. */

import i18n from './i18n'

export type ModuleKey =
  | 'dashboard'
  | 'advisor'
  | 'accounts'
  | 'transactions'
  | 'budget'
  | 'debts'
  | 'recurring'
  | 'subscriptions'
  | 'insights'
  | 'categories'
  | 'reports'
  | 'settings'
  | 'notifications'

export interface TourStepContent {
  /** CSS selector of a real element on screen, via the
   * `data-tour="<moduleKey>:<element>"` attribute. */
  selector: string
  title: string
  text: string
}

export interface TourContent {
  welcome: {
    description: string
    bullets: string[]
  }
  steps: TourStepContent[]
}

const TOUR_SELECTORS: Partial<Record<ModuleKey, string[]>> = {
  dashboard: [
    '[data-tour="dashboard:liquidity"]',
    '[data-tour="dashboard:due-soon"]',
    '[data-tour="dashboard:budget"]',
    '[data-tour="dashboard:month-summary"]',
    '[data-tour="dashboard:cashflow"]',
    '[data-tour="dashboard:networth"]',
    '[data-tour="dashboard:insights-preview"]',
    '[data-tour="dashboard:upcoming"]',
  ],
  accounts: [
    '[data-tour="accounts:new-button"]',
    '[data-tour="accounts:list"]',
    '[data-tour="accounts:detail"]',
    '[data-tour="accounts:tdc-cycle"]',
    '[data-tour="accounts:actions"]',
  ],
  transactions: [
    '[data-tour="transactions:new-button"]',
    '[data-tour="transactions:pay-card-button"]',
    '[data-tour="transactions:split-button"]',
    '[data-tour="transactions:filters"]',
    '[data-tour="transactions:sort"]',
    '[data-tour="transactions:row-actions"]',
    '[data-tour="transactions:calendar"]',
  ],
  budget: [
    '[data-tour="budget:new-limit"]',
    '[data-tour="budget:suggestion"]',
    '[data-tour="budget:available"]',
    '[data-tour="budget:committed"]',
    '[data-tour="budget:alerts"]',
    '[data-tour="budget:distribution"]',
    '[data-tour="budget:trend"]',
    '[data-tour="budget:month-nav"]',
  ],
  debts: [
    '[data-tour="debts:new-button"]',
    '[data-tour="debts:unplanned-button"]',
    '[data-tour="debts:activate-button"]',
    '[data-tour="debts:direction-toggle"]',
    '[data-tour="debts:correct-balance"]',
    '[data-tour="debts:summary"]',
  ],
  recurring: [
    '[data-tour="recurring:new-button"]',
    '[data-tour="recurring:pending"]',
    '[data-tour="recurring:item-actions"]',
    '[data-tour="recurring:status-filter"]',
    '[data-tour="recurring:card-commitments"]',
    '[data-tour="recurring:breakdown"]',
    '[data-tour="recurring:upcoming"]',
  ],
  subscriptions: [
    '[data-tour="subscriptions:new-button"]',
    '[data-tour="subscriptions:committed"]',
    '[data-tour="subscriptions:item-actions"]',
    '[data-tour="subscriptions:aging"]',
    '[data-tour="subscriptions:status-filter"]',
    '[data-tour="subscriptions:renewals"]',
  ],
  advisor: [
    '[data-tour="advisor:suggestions"]',
    '[data-tour="advisor:attach"]',
    '[data-tour="advisor:more"]',
    '[data-tour="advisor:input"]',
    '[data-tour="advisor:context"]',
    '[data-tour="advisor:usage"]',
  ],
  insights: [
    '[data-tour="insights:generate"]',
    '[data-tour="insights:card"]',
    '[data-tour="insights:actions"]',
    '[data-tour="insights:active"]',
    '[data-tour="insights:history"]',
  ],
  reports: [
    '[data-tour="reports:generate-month"]',
    '[data-tour="reports:period-toggle"]',
    '[data-tour="reports:stats"]',
    '[data-tour="reports:adjustments"]',
    '[data-tour="reports:flow-filter"]',
    '[data-tour="reports:categories"]',
    '[data-tour="reports:networth"]',
    '[data-tour="reports:regenerate"]',
  ],
  settings: [
    '[data-tour="settings:profile"]',
    '[data-tour="settings:preferences"]',
    '[data-tour="settings:debt-trouble"]',
    '[data-tour="settings:connected-accounts"]',
    '[data-tour="settings:data"]',
    '[data-tour="settings:delete-account"]',
  ],
  notifications: [
    '[data-tour="notifications:mark-all"]',
    '[data-tour="notifications:list"]',
    '[data-tour="notifications:total-badge"]',
  ],
  categories: [
    '[data-tour="categories:type-toggle"]',
    '[data-tour="categories:new-button"]',
    '[data-tour="categories:first-card"]',
    '[data-tour="categories:actions"]',
    '[data-tour="categories:segbar"]',
    '[data-tour="categories:hidden-section"]',
    '[data-tour="categories:help-button"]',
  ],
}

export function getTourContent(moduleKey: ModuleKey): TourContent | undefined {
  const selectors = TOUR_SELECTORS[moduleKey]
  if (!selectors) return undefined
  const steps = i18n.t(`tours:${moduleKey}.steps`, { returnObjects: true }) as {
    title: string
    text: string
  }[]
  return {
    welcome: {
      description: i18n.t(`tours:${moduleKey}.welcome.description`),
      bullets: i18n.t(`tours:${moduleKey}.welcome.bullets`, { returnObjects: true }) as string[],
    },
    steps: selectors.map((selector, i) => ({ selector, title: steps[i].title, text: steps[i].text })),
  }
}
