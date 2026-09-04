import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Paperclip,
  Plus,
  Receipt,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BulkExcelImportCard } from '@/components/nl/BulkExcelImportCard'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'
import { useAiHistory, useAiUsage, useChatStream, useClearAiHistory } from '@/hooks/useAiChat'
import { useFinancialSnapshot } from '@/hooks/useEngine'
import { useTransactions } from '@/hooks/useTransactions'
import { EXPORT_PROMPT } from '@/lib/importPrompt'
import { amountColor, formatMoney, isPositiveEntryType } from '@/lib/utils'

/** Same thresholds already used by health_score in other screens: 70+ is
 * healthy (green), 40-69 fair (orange), under 40 poor (red). */
function healthScoreColors(score: number): { bg: string; ink: string } {
  if (score >= 70) return { bg: 'var(--nl-accent-soft-bg)', ink: 'var(--nl-accent-ink)' }
  if (score >= 40) return { bg: 'var(--nl-warning-soft-bg)', ink: 'var(--nl-warning-ink)' }
  return { bg: 'var(--nl-danger-soft-bg)', ink: 'var(--nl-danger-ink)' }
}

/** Runway = how many months your liquidity would last if you stopped
 * receiving income -- less than 1 month is a real risk signal, not a
 * neutral data point. */
function runwayColor(months: number): string | undefined {
  if (months < 1) return 'var(--nl-danger-ink)'
  if (months < 3) return 'var(--nl-warning-ink)'
  return 'var(--nl-accent-ink)'
}

const MARKDOWN_COMPONENTS = {
  p: ({ ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ ...props }) => <ul className="mb-2 last:mb-0 pl-4 list-disc space-y-0.5" {...props} />,
  ol: ({ ...props }) => <ol className="mb-2 last:mb-0 pl-4 list-decimal space-y-0.5" {...props} />,
  li: ({ ...props }) => <li {...props} />,
  h1: ({ ...props }) => (
    <h1
      className="text-[15px] font-semibold mt-3 mb-1.5 first:mt-0"
      style={{ color: 'var(--nl-accent-ink)' }}
      {...props}
    />
  ),
  h2: ({ ...props }) => (
    <h2
      className="text-[14px] font-semibold mt-3 mb-1.5 first:mt-0"
      style={{ color: 'var(--nl-accent-ink)' }}
      {...props}
    />
  ),
  h3: ({ ...props }) => <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0" {...props} />,
  em: ({ ...props }) => <em {...props} />,
  a: ({ ...props }) => (
    <a className="underline hover:no-underline" style={{ color: 'var(--nl-accent-ink)' }} {...props} />
  ),
  strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
  hr: () => <hr className="my-3 border-border" />,
  code: ({ ...props }) => (
    <code className="rounded px-1 py-0.5 text-[12px]" style={{ background: 'var(--nl-bg-track)' }} {...props} />
  ),
  table: ({ ...props }) => (
    <div className="overflow-x-auto mb-2">
      <table className="text-[12.5px] border-collapse" {...props} />
    </div>
  ),
  th: ({ ...props }) => <th className="border border-border px-2 py-1 text-left" {...props} />,
  td: ({ ...props }) => <td className="border border-border px-2 py-1" {...props} />,
}

/** Tools that actually write (backend/app/ai/write_tools.py) -- if the
 * advisor's response carries any of these in tool_calls, it really
 * registered/created something. list_existing_accounts_and_debts is
 * read-only (the advisor uses it to look things up, it doesn't count as an
 * action) and create_insight already has its own notice (savedInsight), so
 * they're not listed here. */
const WRITE_TOOLS = ['create_transaction', 'create_account', 'create_debt', 'create_unplanned_debt', 'create_recurring_item']

function messageDidWrite(toolCalls: { tool: string; result: unknown }[] | undefined): boolean {
  return !!toolCalls?.some((call) => WRITE_TOOLS.includes(call.tool))
}

/** propose_action (backend/app/ai/write_tools.py) doesn't write anything --
 * it's the tool the advisor calls to ask for confirmation BEFORE creating
 * something, instead of just asking in the text. If a message carries it,
 * it's rendered as a card with real Confirm/Cancel buttons instead of a
 * plain bubble. */
interface ActionField {
  label: string
  value: string
}
interface ActionProposal {
  action: string
  summary: string
  fields: ActionField[]
}
function findProposal(toolCalls: { tool: string; result: unknown }[] | undefined): ActionProposal | undefined {
  const call = toolCalls?.find((c) => c.tool === 'propose_action')
  return call?.result as ActionProposal | undefined
}

/** Financial action card -- "pending" carries the Confirm/Cancel buttons
 * (inert if `actionable` is false, e.g. the conversation already moved
 * on), "done" just wraps the advisor's confirmation text with the same
 * visual language. */
function ActionCard({
  variant,
  summary,
  fields,
  content,
  actionable,
  onConfirm,
  onCancel,
}: {
  variant: 'pending' | 'done'
  summary?: string
  fields?: ActionField[]
  content?: string
  actionable?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const isPending = variant === 'pending'
  const headerBg = isPending ? 'var(--nl-violet-soft-bg)' : 'var(--nl-accent-soft-bg)'
  const headerInk = isPending ? 'var(--nl-violet-ink)' : 'var(--nl-accent-ink)'
  return (
    <div className="w-full max-w-[380px] rounded-[10px] border border-border overflow-hidden bg-card">
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-semibold"
        style={{ background: headerBg, color: headerInk }}
      >
        {isPending ? <Receipt size={13} className="flex-shrink-0" /> : <CheckCircle2 size={13} className="flex-shrink-0" />}
        {isPending ? 'Confirmar acción' : 'Acción registrada'}
      </div>
      <div className="px-3.5 py-3 flex flex-col gap-2">
        {summary && <p className="text-[12.5px]">{summary}</p>}
        {content && (
          <div className="text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {content}
            </ReactMarkdown>
          </div>
        )}
        {fields && fields.length > 0 && (
          <div className="flex flex-col gap-1.5 text-[12.5px] rounded-md p-2.5" style={{ background: 'var(--nl-bg-input)' }}>
            {fields.map((f, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{f.label}</span>
                <span className="font-medium text-right">{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {isPending && (
        <div className="flex gap-2 px-3.5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!actionable}
            className="flex-1 rounded-md py-2 text-[12.5px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
          >
            <Check size={13} />
            Confirmar
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!actionable}
            className="flex-1 rounded-md py-2 text-[12.5px] border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <X size={13} />
            Cancelar
          </button>
        </div>
      )}
      {isPending && !actionable && (
        <div className="px-3.5 py-2 text-[11px] text-muted-foreground border-t border-border">
          Esta propuesta ya no está activa.
        </div>
      )}
    </div>
  )
}

/** thinkBounce already existed in index.css (probably for this exact
 * purpose) but had never been used -- 3 dots with staggered
 * animation-delay, same visual pattern as the "Conectado" dot (pulseDot)
 * in the header. */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="El asesor está escribiendo">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: 'var(--nl-accent)',
            animation: 'thinkBounce 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  )
}

const SUGGESTIONS = [
  '¿Cómo va mi presupuesto?',
  '¿Qué deuda debería pagar primero?',
  '¿Estoy ahorrando lo suficiente?',
  'Resume mis finanzas',
  'Registra un gasto de $200 en comida hoy',
]

function AdvisorHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Un chat con IA que ve tu situación financiera real (cuentas, deudas, presupuesto, transacciones
          recientes) y responde con eso como contexto — no son respuestas genéricas.
        </p>
      </HelpSection>
      <HelpSection heading="Sugerencias">
        <p>
          Los botones de preguntas comunes son solo un punto de partida — puedes preguntar lo que quieras
          en el cuadro de texto de abajo.
        </p>
      </HelpSection>
      <HelpSection heading="Limpiar historial">
        <p>
          El ícono de basura borra la conversación guardada — útil para empezar de cero, no afecta tus
          datos financieros, solo el chat.
        </p>
      </HelpSection>
      <HelpSection heading="Consultas restantes hoy">
        <p>
          Hay un límite diario de preguntas para controlar el costo de la IA. El número junto a "Conectado"
          te dice cuántas te quedan — se reinicia cada día.
        </p>
      </HelpSection>
      <HelpSection heading="Traer datos históricos">
        <p>
          El 📎 junto al mensaje adjunta estados de cuenta en PDF (funciona aunque tengan contraseña,
          escríbela una sola vez para todo el lote) — el asistente registra los cargos normales y las
          compras a meses (MSI) por su monto total una sola vez, sin duplicar cuando esa misma mensualidad
          reaparece en los estados siguientes. Marcar una compra como MSI para ver su progreso en Cuentas
          es un paso aparte que haces tú al revisar la transacción, el asistente no lo hace solo. El "+"
          tiene dos formas más: cargar un Excel prellenado, o copiar un prompt para pegarlo en otra IA
          (ChatGPT, Gemini) y traer de vuelta un resumen ya estructurado.
        </p>
      </HelpSection>
      <HelpTip>
        Si le pides que guarde un plan o recomendación, lo crea como un Insight que puedes ver después en
        esa sección (te avisamos ahí mismo en el chat cuando pasa). También puede crear cuentas, deudas,
        recurrentes o registrar transacciones si le dictas los datos o le adjuntas un PDF — siempre te
        resume qué va a guardar y espera tu confirmación antes de hacerlo. No puede editar ni borrar nada
        ya existente.
      </HelpTip>
    </>
  )
}

export function Advisor() {
  const { data: snapshot } = useFinancialSnapshot()
  const { data: history } = useAiHistory(1, 20)
  const { data: recentTx } = useTransactions({ per_page: 5 })
  const { data: usage } = useAiUsage()
  const clearHistory = useClearAiHistory()
  const { messages, setMessages, sendMessage, isStreaming, error, canRetry, retryLast, savedInsight } =
    useChatStream()
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [pdfPassword, setPdfPassword] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const seeded = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  // If the user scrolled up to reread the history, a new message (especially
  // one arriving via streaming) shouldn't yank them back down -- that's what
  // the old unconditional auto-scroll did. We only keep following the
  // automatic scroll if it was already pinned to the bottom, or if the new
  // message is from the user themselves (whoever types always expects to see
  // what they just sent). Otherwise, the "new message" notice lights up.
  const isNearBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  useEffect(() => {
    if (seeded.current || !history || messages.length > 0) return
    seeded.current = true
    setMessages(
      [...history.items]
        .reverse()
        .map((m) => ({ role: m.role, content: m.content, toolCalls: m.tool_calls ?? undefined })),
    )
  }, [history, messages.length, setMessages])

  function scrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowJumpButton(false)
  }

  function handleMessagesScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    isNearBottomRef.current = nearBottom
    if (nearBottom) setShowJumpButton(false)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const lastRole = messages.at(-1)?.role
    if (lastRole === 'user' || isNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight })
      isNearBottomRef.current = true
      setShowJumpButton(false)
    } else {
      setShowJumpButton(true)
    }
  }, [messages])

  function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length) setAttachedFiles((prev) => [...prev, ...files])
    event.target.value = ''
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(EXPORT_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function send(text: string) {
    const message = text.trim()
    const hasAttachments = attachedFiles.length > 0
    if ((!message && !hasAttachments) || isStreaming) return
    setInput('')
    const files = attachedFiles
    const password = pdfPassword
    setAttachedFiles([])
    setPdfPassword('')
    // The text shown in the bubble and the one actually sent to the backend
    // are no longer the same string -- useAiChat appends "(adjunto: ...)" to
    // THAT one so the server-side history keeps the context, but here on
    // screen the file name shows as a chip, not as text stuck to the
    // message.
    await sendMessage(message, hasAttachments ? { files, password: password || undefined } : undefined)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send(input)
  }

  /** The propose_action card's buttons send a fixed text through the same
   * chat, instead of making the user type "yes" -- that's what makes
   * confirming unambiguous (the advisor doesn't have to interpret free
   * text) without having to skip the normal conversational flow. */
  function respondToProposal(confirmed: boolean) {
    if (isStreaming) return
    void sendMessage(
      confirmed
        ? 'Sí, confírmalo y regístralo tal cual lo propusiste.'
        : 'No, cancela esa propuesta, no la registres.',
    )
  }

  function handleClear() {
    seeded.current = true
    setMessages([])
    clearHistory.mutate()
  }

  return (
    // No longer bleeds through the Layout's padding (see Layout.tsx: <main>
    // is flex-col, this uses lg:flex-1 lg:min-h-0 to fill the available
    // height without a hand-rolled calc(100vh-Npx)) -- the whole column,
    // header included, ends up with the same gutter as any other screen.
    <div className="flex flex-col lg:flex-1 lg:min-h-0">
      <ViewHeader
        icon={<Bot />}
        title="Asesor IA"
        help={<AdvisorHelp />}
        section={HEADER_SECTIONS.inteligencia}
        tourKey="advisor"
        actions={
          <>
            <span
              className="hidden lg:flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--nl-accent-ink)', animation: 'pulseDot 1.6s ease-in-out infinite' }}
              />
              Conectado
            </span>
            {usage && usage.unlimited && (
              <span
                data-tour="advisor:usage"
                className="rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
                title="Cuenta admin: sin limite diario de consultas"
              >
                Ilimitado
              </span>
            )}
            {usage && !usage.unlimited && (
              <span
                data-tour="advisor:usage"
                className="rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                style={{
                  background: usage.remaining_today <= 5 ? 'var(--nl-warning-soft-bg)' : 'var(--nl-bg-input)',
                  color: usage.remaining_today <= 5 ? 'var(--nl-warning-ink)' : 'var(--nl-text-secondary)',
                }}
                title={`${usage.used_today} de ${usage.limit_per_day} consultas usadas hoy`}
              >
                {usage.remaining_today}/{usage.limit_per_day} hoy
              </span>
            )}
            <span
              className="hidden lg:flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--nl-bg-input)', color: 'var(--nl-text-secondary)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--nl-violet)' }} />
              gemini-flash-latest
            </span>
            <button
              type="button"
              title="Limpiar historial"
              onClick={handleClear}
              className="rounded-full p-2 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </>
        }
      />

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0">
        <div className="relative flex flex-col h-[65vh] lg:h-auto lg:min-h-0 lg:flex-[0_0_60%] min-w-0">
          <div
            ref={scrollRef}
            onScroll={handleMessagesScroll}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 lg:px-8 py-6 flex flex-col gap-4"
          >
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                <Sparkles size={32} className="text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground max-w-xs">
                  Pregúntame sobre tu situación financiera, si puedes pagar algo, o pídeme que te
                  arme un plan de ahorro. También puedo registrar cuentas, deudas y movimientos por
                  ti si me los dictas.
                </p>
              </div>
            ) : (
              messages.map((message, i) => {
                const isLast = i === messages.length - 1
                const didWrite = messageDidWrite(message.toolCalls)
                const proposal = message.role === 'assistant' ? findProposal(message.toolCalls) : undefined
                if (!message.content && !proposal && !didWrite && !(isStreaming && isLast)) return null
                if (message.role === 'user') {
                  return (
                    <div
                      key={i}
                      className="self-end max-w-[70%] flex flex-col items-end gap-1.5 rounded-[14px] rounded-br-sm px-3.5 py-3 text-sm"
                      style={{ background: 'var(--nl-violet-soft-bg)', color: 'var(--nl-violet-ink)' }}
                    >
                      {message.content}
                      {message.attachmentNames && message.attachmentNames.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {message.attachmentNames.map((name, fi) => (
                            <span
                              key={fi}
                              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
                              style={{ background: 'var(--nl-bg-card)', color: 'var(--nl-text-secondary)' }}
                            >
                              <Paperclip size={11} className="flex-shrink-0" />
                              <span className="truncate max-w-[140px]">{name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                const avatar = (
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--nl-accent-soft-bg)' }}
                  >
                    <Sparkles size={12} style={{ color: 'var(--nl-accent-ink)' }} />
                  </span>
                )
                // Proposes an action (create_transaction, create_account, etc.)
                // -- a card with real Confirm/Cancel buttons instead of waiting
                // for the user to type "yes". Only clickable if it's the last
                // message: as soon as the conversation moves on (the user
                // already responded, via button or text) it becomes inert.
                if (proposal) {
                  return (
                    <div key={i} className="self-start max-w-[78%] flex gap-3">
                      {avatar}
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        {message.content && (
                          <div className="rounded-[10px] rounded-tl-sm px-4.5 py-4 text-sm bg-card">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                        <ActionCard
                          variant="pending"
                          summary={proposal.summary}
                          fields={proposal.fields}
                          actionable={isLast && !isStreaming}
                          onConfirm={() => respondToProposal(true)}
                          onCancel={() => respondToProposal(false)}
                        />
                      </div>
                    </div>
                  )
                }
                // Already ran the corresponding write tool -- the same
                // confirmation text from the advisor, but wrapped in the
                // green card instead of a plain bubble with a badge.
                if (didWrite) {
                  return (
                    <div key={i} className="self-start max-w-[78%] flex gap-3">
                      {avatar}
                      <div className="flex-1 min-w-0">
                        <ActionCard variant="done" content={message.content || undefined} />
                      </div>
                    </div>
                  )
                }
                return (
                  <div
                    key={i}
                    className="self-start max-w-[78%] rounded-[10px] rounded-tl-sm px-4.5 py-4 text-sm bg-card flex gap-3"
                  >
                    {avatar}
                    <div className="flex-1 min-w-0">
                      {message.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                          {message.content}
                        </ReactMarkdown>
                      ) : isStreaming && isLast ? (
                        <TypingIndicator />
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
            {savedInsight && (
              <div
                className="self-start flex items-center gap-2 rounded-md px-3 py-2 text-xs"
                style={{ background: 'var(--nl-accent-soft-bg)', color: 'var(--nl-accent-ink)' }}
              >
                <CheckCircle2 size={14} className="flex-shrink-0" />
                <span>Insight guardado: {savedInsight.title}</span>
                <Link to="/insights" className="underline hover:no-underline">
                  Verlo →
                </Link>
              </div>
            )}
            {error && (
              <div className="self-start flex items-center gap-2">
                <p className="text-sm text-destructive">{error}</p>
                {canRetry && (
                  <button
                    type="button"
                    onClick={retryLast}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs border border-border text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <RotateCcw size={12} />
                    Reintentar
                  </button>
                )}
              </div>
            )}
          </div>

          {showJumpButton && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-md"
              style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
            >
              <ChevronDown size={13} />
              Nuevo mensaje
            </button>
          )}

          <form onSubmit={handleSubmit} className="flex-shrink-0 border-t border-border px-4 lg:px-8 py-4 lg:py-5">
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachedFiles.map((file, i) => (
                  <span
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-xs border border-border"
                    style={{ background: 'var(--nl-bg-input)' }}
                  >
                    {file.name}
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Quitar ${file.name}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {attachedFiles.length > 0 && (
              <input
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                disabled={isStreaming}
                placeholder="Contraseña de los PDF (si tienen, misma para todos)"
                className="w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-ring disabled:text-muted-foreground mb-2"
                style={{ background: 'var(--nl-bg-input)' }}
              />
            )}
            <div className="flex items-center gap-2 mb-3">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                multiple
                onChange={handlePdfChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={isStreaming}
                title="Adjuntar estados de cuenta en PDF"
                data-tour="advisor:attach"
                className="flex-shrink-0 w-11 h-11 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                disabled={isStreaming}
                title="Más formas de traer datos (Excel, prompt para otra IA)"
                data-tour="advisor:more"
                className="flex-shrink-0 w-11 h-11 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Plus size={16} />
              </button>
              <div className="relative flex-1" data-tour="advisor:input">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isStreaming}
                  placeholder={
                    attachedFiles.length > 0
                      ? 'Algo de contexto (ej. "son 3 meses de mi TDC Platino")...'
                      : 'Escribe tu pregunta...'
                  }
                  className="w-full h-11 rounded-md border border-border pl-4 pr-11 text-sm outline-none focus:border-ring disabled:text-muted-foreground"
                  style={{ background: 'var(--nl-bg-input)' }}
                />
                <button
                  type="submit"
                  disabled={isStreaming || (!input.trim() && attachedFiles.length === 0)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
            {/* Only before the first message -- once the conversation
                starts, these 5 suggestions no longer add value (the user
                is typing what they need) and only take up useful height
                from the history. */}
            {messages.length === 0 && (
              <div className="flex gap-2 flex-wrap" data-tour="advisor:suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => void send(s)}
                    className="rounded-full px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Deliberately WITHOUT overflow-y-auto -- this panel never scrolls,
            it stays fixed while the chat (on the left) is the only thing
            that moves. Its content is finite (summary + up to 5
            transactions), so it doesn't need its own scroll --
            overflow-hidden is just a safeguard in case it ever grows more
            than expected, so in that case it gets clipped instead of
            pushing the page again. */}
        <div
          className="border-t lg:border-t-0 lg:border-l border-border overflow-hidden p-4 lg:p-5 lg:flex-[0_0_40%]"
          style={{ background: 'var(--sidebar)' }}
          data-tour="advisor:context"
        >
          <div className="text-[11px] tracking-wide text-muted-foreground font-semibold mb-2">
            RESUMEN FINANCIERO
          </div>
          <div className="text-[26px] font-light mb-1" style={{ color: amountColor(snapshot?.net_worth.net_worth) }}>
            {formatMoney(snapshot?.net_worth.net_worth)}
          </div>
          <div className="text-xs text-muted-foreground mb-3">Patrimonio neto</div>

          <div className="flex flex-col mb-4">
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">Salud financiera</span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={
                  snapshot
                    ? {
                        background: healthScoreColors(snapshot.health_score.score).bg,
                        color: healthScoreColors(snapshot.health_score.score).ink,
                      }
                    : undefined
                }
              >
                {snapshot ? `${snapshot.health_score.score}/100` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">Comprometido / mes</span>
              <span>{formatMoney(snapshot?.committed_monthly)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">Disponible esta semana</span>
              <span style={{ color: amountColor(snapshot?.available_this_week.available) }}>
                {formatMoney(snapshot?.available_this_week.available)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-border text-[13px]">
              <span className="text-muted-foreground">Runway</span>
              <span style={{ color: snapshot ? runwayColor(snapshot.runway.months) : undefined }}>
                {snapshot?.runway.label ?? '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] tracking-wide text-muted-foreground font-semibold">
              TRANSACCIONES RECIENTES
            </span>
            <Link to="/transactions" className="text-[11px] text-muted-foreground hover:text-foreground">
              Ver todas →
            </Link>
          </div>
          <div className="flex flex-col">
            {(recentTx?.data ?? []).map((tx) => {
              const positive = isPositiveEntryType(tx.entry_type)
              const color = positive ? 'var(--nl-accent-ink)' : 'var(--nl-danger-ink)'
              return (
                <div key={tx.id} className="flex items-center gap-2 py-1.5 border-t border-border first:border-0">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="flex-1 text-[12px] truncate">{tx.description}</span>
                  <span className="text-[12px]" style={{ color }}>
                    {positive ? '+' : '−'}
                    {formatMoney(tx.amount ?? '0')}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground italic mt-4">
            El asesor usa este mismo snapshot financiero y varias herramientas para responder con tus
            datos reales, y puede crear cuentas, deudas, recurrentes o transacciones si le pides que
            los registre (siempre te va a confirmar antes de guardar algo).
          </p>
        </div>
      </div>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Más formas de traer datos</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <div>
              <div className="text-[15px] font-semibold mb-1">Carga masiva desde Excel</div>
              <BulkExcelImportCard />
            </div>
            <div className="pt-4 border-t border-border">
              <div className="text-[15px] font-semibold mb-1">Prompt para tu otro chat</div>
              <p className="text-sm text-muted-foreground mb-3">
                Cópialo y pégalo en la conversación donde llevabas el registro de tus finanzas (ChatGPT,
                Gemini, etc.). Esa IA te devolverá un resumen que puedes pegar aquí en el chat.
              </p>
              <button
                type="button"
                onClick={copyPrompt}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border py-2 text-sm hover:bg-muted"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copiado' : 'Copiar prompt'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
