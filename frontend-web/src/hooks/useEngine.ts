import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { ApiSuccess } from '@/types'

export interface NetWorth {
  total_assets: string
  total_liabilities: string
  net_worth: string
}

export interface IncomeEstimate {
  recurring_base: string
  historical_avg_3m: string
  estimated_monthly: string
  data_quality: 'historical' | 'recurring_base'
}

export interface HealthScoreComponent {
  value: number
  score: number
}

export interface HealthScore {
  score: number
  components: {
    dti: HealthScoreComponent
    savings_rate: HealthScoreComponent
    emergency_coverage_months: HealthScoreComponent
    credit_utilization: HealthScoreComponent
  }
}

export interface AvailableSpending {
  liquid_balance: string
  committed_in_period: string
  available: string
  period: string
}

export interface Runway {
  days: number
  months: number
  label: string
}

export interface UpcomingPayment {
  date: string
  name: string
  amount: string
  type: string
}

export interface FinancialSnapshot {
  as_of: string
  net_worth: NetWorth
  income: IncomeEstimate
  committed_monthly: string
  spent_this_month: string
  health_score: HealthScore
  available_this_week: AvailableSpending
  upcoming_7_days: UpcomingPayment[]
  runway: Runway
}

export function useFinancialSnapshot() {
  return useQuery({
    queryKey: ['engine', 'snapshot'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<FinancialSnapshot>>('/engine/snapshot')
      return data.data
    },
  })
}
