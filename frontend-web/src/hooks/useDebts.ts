import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type {
  ApiSuccess,
  Debt,
  DebtDirection,
  DebtSummary,
  DebtType,
  PaymentFrequency,
  UnplannedDebt,
} from '@/types'

/** Cualquier mutacion de deudas puede tocar listas (por direccion), resumen,
 * proximos pagos y sin-plan a la vez -- mas simple invalidar todo ['debts']
 * que mantener parches manuales de cache por cada variante de queryKey. */
function invalidateDebts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['debts'] })
}

export function useUnplannedDebts() {
  return useQuery({
    queryKey: ['debts', 'unplanned'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<UnplannedDebt[]>>('/debts/unplanned')
      return data.data
    },
  })
}

export function useDebts(direction?: DebtDirection) {
  return useQuery({
    queryKey: ['debts', 'list', direction ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<Debt[]>>('/debts', { params: { direction } })
      return data.data
    },
  })
}

export function useDebtSummary() {
  return useQuery({
    queryKey: ['debts', 'summary'],
    queryFn: async () => {
      const { data } = await api.get<ApiSuccess<DebtSummary>>('/debts/summary')
      return data.data
    },
  })
}

export interface CreateUnplannedDebtInput {
  name: string
  creditor?: string
  amount: string
  direction: DebtDirection
  notes?: string
}

export function useCreateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateUnplannedDebtInput) => {
      const { data } = await api.post<ApiSuccess<UnplannedDebt>>('/debts/unplanned', input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface ActivateDebtInput {
  agreed_amount?: string
  payment_amount: string
  payment_frequency: PaymentFrequency
  payment_day?: number
  total_installments?: number
  linked_account_id?: string
  /** Cuenta real donde ya entro/salio el efectivo de este prestamo -- la
   * deuda sin plan nunca toca balances por diseno, esta es la primera
   * oportunidad de registrar el movimiento real. */
  funding_account_id?: string
  start_date: string
  due_date?: string
}

export function useActivateUnplannedDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ActivateDebtInput }) => {
      const { data } = await api.post<ApiSuccess<Debt>>(`/debts/unplanned/${id}/activate`, input)
      return data.data
    },
    onSuccess: (_debt, { input }) => {
      invalidateDebts(queryClient)
      if (input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface CreateDebtInput {
  name: string
  creditor?: string
  type: DebtType
  direction: DebtDirection
  total_amount: string
  current_balance?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  total_installments?: number
  linked_account_id?: string
  /** Cuenta real donde ya entro/salio el efectivo al originar esta deuda. */
  funding_account_id?: string
  start_date?: string
  is_shared?: boolean
  responsible_party?: string
  initial_charge?: {
    category_id: string
    paying_account_id: string
    description: string
  }
}

export function useCreateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDebtInput) => {
      const { data } = await api.post<ApiSuccess<Debt>>('/debts', input)
      return data.data
    },
    onSuccess: (_debt, input) => {
      invalidateDebts(queryClient)
      // initial_charge (MSI) o funding_account_id son los unicos casos que
      // generan una transaccion real -- ahi si cambian cuentas/transacciones.
      if (input.initial_charge || input.funding_account_id) {
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['transactions'] })
      }
    },
  })
}

export interface UpdateDebtInput {
  name?: string
  payment_amount?: string
  payment_frequency?: PaymentFrequency
  payment_day?: number
  next_payment_date?: string
  linked_account_id?: string
  payment_source_account_id?: string
  notes?: string
}

/** PUT /debts/{id} (backend/app/routers/debts.py) ya existia listo desde
 * siempre -- lo unico que faltaba era que el frontend lo usara. Hoy solo lo
 * consume la resolucion inline de "cuenta vinculada" en el modal de pago
 * (ver RegisterPaymentForm en Debts.tsx), pero sirve para cualquier campo de
 * DebtUpdate. */
export function useUpdateDebt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateDebtInput }) => {
      const { data } = await api.put<ApiSuccess<Debt>>(`/debts/${id}`, input)
      return data.data
    },
    onSuccess: () => invalidateDebts(queryClient),
  })
}

export interface RegisterDebtPaymentInput {
  account_id: string
  amount: string
  date: string
  notes?: string
}

export function useRegisterDebtPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ debtId, input }: { debtId: string; input: RegisterDebtPaymentInput }) => {
      const { data } = await api.post(`/debts/${debtId}/payments`, input)
      return data.data
    },
    onSuccess: () => {
      invalidateDebts(queryClient)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
