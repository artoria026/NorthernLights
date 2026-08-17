import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogPrimaryButton } from '@/components/nl/DialogActions'
import { EditTransactionModal } from '@/components/nl/EditTransactionModal'
import { DemoFlow, HelpSection, HelpTip } from '@/components/nl/Help'
import { CategoryBadge, HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import { TransactionsCalendar } from '@/components/nl/TransactionsCalendar'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { useCreateSplitExpense, useDeleteTransaction, useTransactions } from '@/hooks/useTransactions'
import { apiErrorMessage } from '@/services/api'
import {
  entryTypeLabel,
  formatMoney as formatMoneyBase,
  isPositiveEntryType,
  isTransactionEditable,
  selectClass,
} from '@/lib/utils'
import { useConfirmStore } from '@/stores/confirmStore'
import { useTransactionModalStore } from '@/stores/transactionModalStore'
import { useUiStore } from '@/stores/uiStore'
import type { Transaction } from '@/types'

type TypeFilter = 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER'
const PAGE_SIZE = 8

function formatMoney(value: string | null) {
  return value ? formatMoneyBase(value) : '—'
}

interface DebtorRow {
  person_name: string
  amount: string
}

function SplitExpenseForm({ onDone }: { onDone: () => void }) {
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories('expense')
  const { data: receivables } = useDebts('owed_to_me')
  const createSplit = useCreateSplitExpense()

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [payingAccountId, setPayingAccountId] = useState('')
  const [myShare, setMyShare] = useState('')
  const [debtors, setDebtors] = useState<DebtorRow[]>([{ person_name: '', amount: '' }])

  function updateDebtor(index: number, patch: Partial<DebtorRow>) {
    setDebtors((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addDebtor() {
    setDebtors((rows) => [...rows, { person_name: '', amount: '' }])
  }

  function removeDebtor(index: number) {
    setDebtors((rows) => rows.filter((_, i) => i !== index))
  }

  const total = (Number(myShare) || 0) + debtors.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const validDebtors = debtors.filter((d) => d.person_name.trim() && d.amount)
    if (!categoryId || !payingAccountId || !myShare || validDebtors.length === 0) return

    try {
      await createSplit.mutateAsync({
        date,
        description,
        category_id: categoryId,
        paying_account_id: payingAccountId,
        my_share: myShare,
        debtors: validDebtors.map((d) => ({ person_name: d.person_name.trim(), amount: d.amount })),
      })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Fecha</label>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${selectClass} h-9 w-full`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Descripción</label>
        <input
          required
          placeholder="Cena con amigos"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categoría</label>
        <Select value={categoryId || null} onValueChange={(v) => setCategoryId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Selecciona una categoría">
              {(v: string | null) => categories?.find((c) => c.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Cuenta que paga el total</label>
        <Select value={payingAccountId || null} onValueChange={(v) => setPayingAccountId(v ?? '')}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Selecciona una cuenta">
              {(v: string | null) => accounts?.find((a) => a.id === v)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Mi parte real</label>
        <input
          type="number"
          step="0.01"
          required
          value={myShare}
          onChange={(e) => setMyShare(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">Quién más debe</label>
        {debtors.map((debtor, index) => (
          <div key={index} className="flex gap-2 items-center">
            <input
              required
              list="split-debtor-names"
              placeholder="Nombre"
              className={`${selectClass} h-9 flex-1`}
              value={debtor.person_name}
              onChange={(e) => updateDebtor(index, { person_name: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              required
              className={`${selectClass} h-9 w-28`}
              placeholder="Monto"
              value={debtor.amount}
              onChange={(e) => updateDebtor(index, { amount: e.target.value })}
            />
            {debtors.length > 1 && (
              <button
                type="button"
                onClick={() => removeDebtor(index)}
                className="rounded px-2.5 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground"
              >
                Quitar
              </button>
            )}
          </div>
        ))}
        <datalist id="split-debtor-names">
          {receivables?.map((r) => <option key={r.id} value={r.name} />)}
        </datalist>
        <button
          type="button"
          onClick={addDebtor}
          className="w-fit flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground"
        >
          <UserPlus size={13} />
          Agregar deudor
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Cargo total en "{accounts?.find((a) => a.id === payingAccountId)?.name ?? 'la cuenta que paga'}":{' '}
        {total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
      </p>

      {createSplit.isError && <p className="text-sm text-destructive">{apiErrorMessage(createSplit.error)}</p>}
      <DialogPrimaryButton icon={Check} pending={createSplit.isPending}>
        Guardar gasto compartido
      </DialogPrimaryButton>
    </form>
  )
}

function txType(tx: Transaction): TypeFilter {
  if (tx.entry_type === 'income') return 'INCOME'
  if (tx.entry_type === 'expense') return 'EXPENSE'
  return 'TRANSFER'
}

function TransactionRow({
  tx,
  accountName,
  categoryColorById,
  onEdit,
}: {
  tx: Transaction
  accountName: string
  categoryColorById: Map<string, string>
  onEdit: (tx: Transaction) => void
}) {
  const deleteTransaction = useDeleteTransaction()
  const pushToast = useUiStore((s) => s.pushToast)
  const confirm = useConfirmStore((s) => s.ask)
  const editable = isTransactionEditable(tx)

  async function handleDelete() {
    const ok = await confirm({
      title: 'Eliminar transacción',
      message: `¿Eliminar la transacción "${tx.description}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteTransaction.mutateAsync(tx.id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <>
      {/* Fila de tabla -- solo lg+. La misma info en 6 columnas de ancho fijo
          no cabe en un telefono, por eso hay una version aparte abajo. */}
      <div className="hidden lg:grid grid-cols-[90px_2fr_1fr_1fr_1fr_90px] gap-2 items-center px-3 py-2.5 text-[13px] border-t border-border">
        <span className="text-muted-foreground">{tx.date}</span>
        <span className="truncate">{tx.description}</span>
        <span className="text-muted-foreground truncate">{accountName}</span>
        <span>
          <CategoryBadge
            name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
            color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
          />
        </span>
        <span
          className={`text-right ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
        >
          {formatMoney(tx.amount)}
        </span>
        <span className="text-right flex items-center justify-end gap-0.5">
          {editable && (
            <button
              type="button"
              onClick={() => onEdit(tx)}
              title="Editar"
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteTransaction.isPending}
            title="Eliminar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {/* Card -- solo mobile */}
      <div className="lg:hidden flex flex-col gap-1.5 px-3 py-3 text-[13px] border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{tx.description}</span>
          <span
            className={`flex-shrink-0 ${isPositiveEntryType(tx.entry_type) ? 'text-[color:var(--nl-accent-ink)]' : ''}`}
          >
            {formatMoney(tx.amount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CategoryBadge
              name={tx.category_name ?? entryTypeLabel(tx.entry_type)}
              color={tx.category_id ? categoryColorById.get(tx.category_id) : undefined}
            />
            <span className="text-muted-foreground truncate text-[12px]">{accountName}</span>
          </div>
          <span className="text-muted-foreground text-[12px] flex-shrink-0">{tx.date}</span>
        </div>
        <div className="self-end flex items-center gap-0.5">
          {editable && (
            <button
              type="button"
              onClick={() => onEdit(tx)}
              title="Editar"
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteTransaction.isPending}
            title="Eliminar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </>
  )
}

function TransactionsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          El historial completo de tus movimientos: ingresos, gastos, transferencias y préstamos. Puedes
          filtrar por cuenta, tipo, fecha o texto, y ver los mismos datos como calendario a la derecha —
          click en un día filtra la lista automáticamente.
        </p>
      </HelpSection>
      <HelpSection heading="+ Nueva transacción">
        <p>
          Registra un ingreso, gasto o transferencia entre dos de tus cuentas. Para ingreso/gasto solo
          eliges cuenta, categoría y monto — la app resuelve sola la contraparte contable, nunca tienes que
          elegirla.
        </p>
      </HelpSection>
      <HelpSection heading="Gasto compartido">
        <p>
          Para cuando pagaste algo que solo parcialmente es tu gasto (ej. una cena grupal). Registras el
          cargo completo a tu cuenta/tarjeta, cuánto es realmente tuyo, y cuánto le corresponde a cada
          quien — su parte queda como saldo a favor tuyo en Deudas ("Me deben"), no como tu gasto.
        </p>
        <DemoFlow
          items={[
            { label: 'TDC', sublabel: '−$500', tone: 'neg' },
            { label: 'Mi gasto', sublabel: '$100', tone: 'warn' },
            { label: 'Me deben', sublabel: '+$400', tone: 'pos' },
          ]}
        />
      </HelpSection>
      <HelpTip>
        Prestar dinero directo (sin compra de por medio) o que te presten a ti ya no vive aquí — está en{' '}
        <strong>Deudas</strong>, junto con todo lo demás que involucra deber dinero en cualquier
        dirección.
      </HelpTip>
    </>
  )
}

export function Transactions() {
  const { data, isLoading, isError } = useTransactions({ per_page: 100 })
  const { data: accounts } = useAccounts()
  const { data: allCategories } = useCategories()
  const categoryColorById = new Map((allCategories ?? []).map((c) => [c.id, c.color]))
  const [splitOpen, setSplitOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const openDetailed = useTransactionModalStore((s) => s.openDetailed)
  const [searchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState(() => searchParams.get('account') ?? 'all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? '—'
  const txAccountId = (tx: Transaction) => tx.lines[0]?.account_id ?? ''

  const categoryOptions = useMemo(() => {
    const names = new Set((data?.data ?? []).map((tx) => tx.entry_type))
    return Array.from(names)
  }, [data])

  const filtered = (data?.data ?? [])
    .filter((tx) => (search ? tx.description.toLowerCase().includes(search.toLowerCase()) : true))
    .filter((tx) => (accountFilter === 'all' ? true : txAccountId(tx) === accountFilter))
    .filter((tx) => (categoryFilter === 'all' ? true : tx.entry_type === categoryFilter))
    .filter((tx) => (dateFrom ? tx.date >= dateFrom : true))
    .filter((tx) => (dateTo ? tx.date <= dateTo : true))
    .filter((tx) => (typeFilter === 'ALL' ? true : txType(tx) === typeFilter))
    .sort((a, b) => (sortDir === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))

  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)
  const clampedPage = Math.min(page, maxPage)
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

  function resetPage() {
    setPage(0)
  }

  const selectedCalendarDate = dateFrom && dateFrom === dateTo ? dateFrom : null
  function handleSelectCalendarDate(date: string | null) {
    setDateFrom(date ?? '')
    setDateTo(date ?? '')
    resetPage()
  }

  return (
    <div>
      <ViewHeader
        icon={<ArrowLeftRight />}
        title="Transacciones"
        help={<TransactionsHelp />}
        section={HEADER_SECTIONS.diario}
        actions={
          <>
            <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] border border-border text-muted-foreground hover:text-foreground"
                  >
                    <Users size={14} />
                    Gasto compartido
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Gasto compartido</DialogTitle>
                </DialogHeader>
                <SplitExpenseForm onDone={() => setSplitOpen(false)} />
              </DialogContent>
            </Dialog>
            <button
              type="button"
              onClick={() => openDetailed()}
              className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <Plus size={14} />
              Nueva transacción
            </button>
          </>
        }
      />

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div className="bg-card border border-border rounded-md p-3.5 mb-4 flex gap-2.5 flex-wrap items-center">
            <input
              placeholder="Buscar"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9 flex-1 min-w-[180px]`}
            />
            <Select
              value={accountFilter}
              onValueChange={(v) => {
                setAccountFilter(v ?? 'all')
                resetPage()
              }}
            >
              <SelectTrigger className="h-9 w-auto">
                <SelectValue>
                  {(v: string) => (v === 'all' ? 'Todas las cuentas' : accounts?.find((a) => a.id === v)?.name)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las cuentas</SelectItem>
                {accounts?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v ?? 'all')
                resetPage()
              }}
            >
              <SelectTrigger className="h-9 w-auto">
                <SelectValue>{(v: string) => (v === 'all' ? 'Todos los tipos' : entryTypeLabel(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {entryTypeLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9`}
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                resetPage()
              }}
              className={`${selectClass} h-9`}
            />
            <SegmentedControl
              value={typeFilter}
              onChange={(v: TypeFilter) => {
                setTypeFilter(v)
                resetPage()
              }}
              options={[
                { value: 'ALL', label: 'TODO' },
                { value: 'INCOME', label: 'INGRESO' },
                { value: 'EXPENSE', label: 'GASTO' },
                { value: 'TRANSFER', label: 'TRANSFER' },
              ]}
            />
          </div>

          <div className="bg-card border border-border rounded-md overflow-hidden">
            <div className="hidden lg:grid grid-cols-[90px_2fr_1fr_1fr_1fr_90px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                className="text-left hover:text-foreground"
              >
                Fecha {sortDir === 'asc' ? '▲' : '▼'}
              </button>
              <span>Descripción</span>
              <span>Cuenta</span>
              <span>Categoría</span>
              <span className="text-right">Monto</span>
              <span className="text-right">Acciones</span>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground p-6">Cargando...</p>
            ) : isError ? (
              <p className="text-sm text-destructive p-6">No se pudieron cargar las transacciones.</p>
            ) : pageRows.length === 0 ? (
              <p className="text-center text-[12px] text-muted-foreground py-7">
                Ninguna transacción coincide con tus filtros.
              </p>
            ) : (
              pageRows.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  accountName={accountName(txAccountId(tx))}
                  categoryColorById={categoryColorById}
                  onEdit={setEditingTx}
                />
              ))
            )}
          </div>

          <div className="flex justify-between items-center mt-3.5 text-xs text-muted-foreground">
            <span>
              Mostrando {filtered.length === 0 ? 0 : clampedPage * PAGE_SIZE + 1}–
              {Math.min(filtered.length, clampedPage * PAGE_SIZE + PAGE_SIZE)} de {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={clampedPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
              >
                <ChevronLeft size={13} />
                Anterior
              </button>
              <button
                type="button"
                disabled={clampedPage >= maxPage}
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                className="flex items-center gap-1 rounded px-3 py-1.5 border border-border disabled:opacity-40"
              >
                Siguiente
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-[260px] flex-shrink-0 bg-card border border-border rounded-md p-3">
          <TransactionsCalendar selectedDate={selectedCalendarDate} onSelectDate={handleSelectCalendarDate} />
        </div>
      </div>

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />
    </div>
  )
}
