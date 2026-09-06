export type PayCycle = 'weekly' | 'biweekly' | 'monthly'
export type Theme = 'dark' | 'light'
export type Locale = 'es' | 'en'

export interface User {
  id: string
  email: string
  name: string
  avatar_url: string | null
  role: string
  auth_provider: string
  theme: Theme
  locale: Locale
  email_notifications: boolean
  push_notifications: boolean
  pay_cycle: PayCycle
  debt_trouble_mode: boolean
  last_seen_changelog_version: string | null
  accepted_disclaimer_version: string | null
  /** Always = the version currently in effect on the backend (settings.DISCLAIMER_VERSION) --
   * comparing it against accepted_disclaimer_version is what decides whether
   * DisclaimerGate blocks the app (see components/DisclaimerGate.tsx). */
  current_disclaimer_version: string
  created_at: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface Account {
  id: string
  name: string
  type: 'asset' | 'liability' | 'income' | 'expense' | 'equity'
  subtype: string | null
  last_4_digits: string | null
  currency: string
  color: string
  notes: string | null
  logo_data_url: string | null
  balance: string
  initial_balance: string
  is_active: boolean
  credit_limit: string | null
  interest_rate: string | null
  billing_cycle_day: number | null
  payment_due_day: number | null
  created_at: string
}

export interface AccountSummary {
  total_assets: string
  total_liabilities: string
  net_worth: string
}

export interface AccountReconcileResult {
  adjusted: boolean
  previous_balance: string
  new_balance: string
  delta: string
  transaction: Transaction | null
}

export interface TdcCycle {
  statement_balance: string
  current_cycle_balance: string
  total_balance: string
  available_credit: string | null
  payment_due_date: string | null
  days_until_due: number | null
  billing_cycle_day: number | null
  payment_due_day: number | null
}

export interface Category {
  id: string
  user_id: string | null
  name: string
  type: 'income' | 'expense'
  icon: string | null
  color: string
  is_system: boolean
  is_active: boolean
  sort_order: number
  parent_id: string | null
  created_at: string
}

export type EntryType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'loan_received'
  | 'loan_repayment'
  | 'loan_given'
  | 'loan_collection'
  | 'adjustment_in'
  | 'adjustment_out'

export interface JournalLine {
  id: string
  account_id: string
  amount: string
  type: 'debit' | 'credit'
}

export interface InstallmentInfo {
  total_installments: number
  paid_installments: number
  monthly_amount: string
}

export interface Transaction {
  id: string
  date: string
  description: string
  notes: string | null
  tags: string[] | null
  amount: string | null
  entry_type: EntryType
  category_id: string | null
  category_name: string | null
  status: 'draft' | 'confirmed' | 'rejected'
  is_recurring: boolean
  created_at: string
  lines: JournalLine[]
  /** Only present if the purchase was recorded as "interest-free installments" (meses sin intereses) against
   * a credit card -- see installment_total in useCreateTransaction. */
  installment: InstallmentInfo | null
}

export type DebtType =
  | 'personal_loan'
  | 'payroll_loan'
  | 'informal'
  | 'civic'
  | 'loan_received'

export type PaymentFrequency = 'weekly' | 'biweekly' | 'monthly' | 'irregular'

/** owed_by_me: money YOU owe (Mireya, the bank, your grandpa). owed_to_me:
 * money owed TO you (you lent it to someone). Same model, same UI for
 * "unplanned"/full plan -- only who owes whom changes. */
export type DebtDirection = 'owed_by_me' | 'owed_to_me'

export interface UnplannedDebt {
  id: string
  name: string
  creditor: string | null
  amount: string
  direction: DebtDirection
  notes: string | null
  status: 'pending' | 'converted'
  converted_to_debt_id: string | null
  created_at: string
}

export interface Debt {
  id: string
  unplanned_debt_id: string | null
  name: string
  creditor: string | null
  type: DebtType
  direction: DebtDirection
  original_amount: string | null
  agreed_amount: string | null
  total_amount: string
  current_balance: string
  interest_rate: string
  payment_amount: string | null
  payment_frequency: PaymentFrequency | null
  payment_day: number | null
  total_installments: number | null
  paid_installments: number
  status: 'active' | 'completed' | 'negotiating'
  linked_account_id: string | null
  start_date: string | null
  estimated_end_date: string | null
  next_payment_date: string | null
  due_date: string | null
  is_shared: boolean
  responsible_party: string | null
  notes: string | null
  created_at: string
}

export interface DebtSummary {
  total_owed_by_me: string
  total_owed_to_me: string
  monthly_committed: string
  active_count: number
  unplanned_owed_by_me: string
  unplanned_owed_to_me: string
}

export type RecurringItemType = 'subscription' | 'service' | 'utility' | 'income'
export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'annual'
export type AlertUrgency = 'normal' | 'high' | 'critical'

export interface RecurringItem {
  id: string
  name: string
  description: string | null
  item_type: RecurringItemType
  amount: string
  frequency: RecurringFrequency
  frequency_day: number | null
  account_id: string
  contra_account_id: string
  category_id: string
  status: 'active' | 'paused' | 'cancelled'
  cancelled_at: string | null
  alert_urgency: AlertUrgency
  auto_generate: boolean
  last_generated_at: string | null
  next_date: string
  notes: string | null
  url: string | null
  created_at: string
}

export interface BudgetLimit {
  category_id: string
  category_name: string
  monthly_limit: string
}

export interface BudgetLimitSuggestion {
  category_id: string
  category_name: string
  color: string
  current_limit: string | null
  average_last_3_months: string
}

export interface BudgetCategoryBreakdown {
  category_id: string
  category_name: string
  monthly_limit: string
  spent: string
  remaining: string
  percentage: number
  alert: boolean
  average_last_3_months: string
}

export interface BudgetCurrent {
  period: { year: number; month: number }
  committed_fixed: string
  variable_categories: BudgetCategoryBreakdown[]
  variable_total_budgeted: string
  variable_total_spent: string
  income_estimated: string
  available: string
}

export interface WeekBreakdown {
  week: number
  date_from: string
  date_to: string
  spent_by_category: Record<string, string>
  weekly_limit_reference: Record<string, string>
}

export interface WeeklyBudget {
  weeks: WeekBreakdown[]
}

export interface BudgetTrendMonth {
  year: number
  month: number
  budgeted: string
  spent: string
  percentage: number
}

export type NotificationType =
  | 'report_ready'
  | 'insight_generated'
  | 'insight_reviewed'
  | 'debt_alert'
  | 'budget_alert'
  | 'tdc_due'
  | 'pending_payment'
  | 'pending_payment_reminder'
  | 'subscription_alert'
  | 'loan_overdue'

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string | null
  type: NotificationType
  is_read: boolean
  read_at: string | null
  action_url: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  created_at: string
}

export type InsightCategory = 'spending' | 'debt' | 'savings' | 'income' | 'budget' | 'general'
export type InsightPriority = 'high' | 'medium' | 'low'
export type InsightStatus = 'active' | 'dismissed' | 'resolved'
export type InsightTrend = 'improved' | 'worsened' | 'stable'

export interface Insight {
  id: string
  title: string
  description: string
  category: InsightCategory
  priority: InsightPriority
  generated_by: 'auto_celery' | 'user_chat'
  ai_provider: string
  metrics_at_creation: Record<string, unknown>
  metrics_at_last_review: Record<string, unknown> | null
  status: InsightStatus
  review_frequency: 'weekly' | 'biweekly' | 'monthly'
  next_review_at: string
  last_reviewed_at: string | null
  review_count: number
  created_at: string
}

export interface InsightReview {
  id: string
  reviewed_at: string
  metrics: Record<string, unknown>
  trend: InsightTrend
  ai_assessment: string
  next_review_at: string
}

export type ReportType = 'monthly_auto' | 'monthly_manual' | 'yearly_auto' | 'yearly_manual' | 'custom'
export type ReportInsightFlowType = 'income' | 'expense' | 'general'
export type ReportStatus = 'generating' | 'ready' | 'error'

/** amount is Decimal on the backend -- json_safe() serializes it as a string
 * (same pattern as any other amount in the app, see Transaction.amount)
 * before saving it into reports.summary (JSONB). savings_rate/dti/health_score
 * ARE native Python floats, that's why they're the only numbers here. */
export interface ReportCategoryAmount {
  category: string
  amount: string
  /** Only present on a parent category's row -- the expense/income of
   * its subcategories is already summed into `amount`, this is the breakdown. */
  subcategories?: ReportCategoryAmount[]
}

export interface ReportSummary {
  period: { start: string; end: string }
  income: { total: string; by_category: ReportCategoryAmount[] }
  expenses: { total: string; by_category: ReportCategoryAmount[] }
  committed: { debts_paid: string; recurring_paid: string }
  // Absent in reports generated before this feature existed (the
  // JSON already persisted in `reports.summary` doesn't regenerate on its own) -- always
  // optional in the type, never assume it exists without checking.
  adjustments?: { total_in: string; total_out: string; net: string; count: number }
  net_worth: { start: string; end: string; delta: string }
  health_score: { value: number; previous: number | null; trend: InsightTrend | null }
  savings_rate: number
  dti: number
}

export interface ReportInsight {
  id: string
  report_id: string
  flow_type: ReportInsightFlowType
  title: string
  description: string
  category_name: string | null
  created_at: string
}

export interface Report {
  id: string
  type: ReportType
  period_start: string
  period_end: string
  status: ReportStatus
  summary: ReportSummary | null
  generated_by: 'auto' | 'user'
  generated_at: string | null
  error_message: string | null
  created_at: string
  insights: ReportInsight[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  tool_calls: { tool: string; result: unknown }[] | null
  ai_provider: string | null
  created_at: string
}

export interface AiUsage {
  used_today: number
  remaining_today: number
  limit_per_day: number
  unlimited: boolean
}

export interface Meta {
  total: number
  page: number
  per_page: number
}

export interface ApiSuccess<T> {
  data: T
  meta?: Meta
}
