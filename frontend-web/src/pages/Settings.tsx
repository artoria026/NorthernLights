import { Check, LogOut, Settings as SettingsIcon, ShieldCheck, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PasswordInput } from '@/components/ui/password-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { ToggleSwitch, ViewHeader } from '@/components/nl/primitives'
import {
  useChangePassword,
  useDeleteAccount,
  useLogout,
  useSyncedTheme,
  useUnlinkGoogle,
  useUpdateProfile,
  useUpdateSettings,
} from '@/hooks/useAuth'
import { type DataCategory, useEraseData } from '@/hooks/useData'
import { apiErrorMessage } from '@/services/api'
import { fileToNormalizedDataUrl, validateImageFile } from '@/lib/image'
import { selectClass } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { PayCycle, Theme } from '@/types'

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-md p-5">
      <div className="text-[15px] font-semibold mb-4">{title}</div>
      {children}
    </div>
  )
}

function AvatarField() {
  const user = useAuthStore((s) => s.user)
  const updateProfile = useUpdateProfile()
  const [error, setError] = useState('')

  async function handleFile(file: File | undefined) {
    if (!file || !user) return
    setError('')
    const validationError = validateImageFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      const dataUrl = await fileToNormalizedDataUrl(file)
      await updateProfile.mutateAsync({ name: user.name, avatar_url: dataUrl })
    } catch {
      setError('No se pudo procesar la imagen.')
    }
  }

  async function handleRemove() {
    if (!user) return
    await updateProfile.mutateAsync({ name: user.name, avatar_url: null })
  }

  return (
    <div className="flex items-center gap-3 mb-4">
      {user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="w-[52px] h-[52px] rounded-full object-cover" />
      ) : (
        <div
          className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl font-semibold"
          style={{ background: 'var(--nl-bg-track)' }}
        >
          {user?.name.slice(0, 2).toUpperCase() || '?'}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <label className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer underline underline-offset-2">
            {user?.avatar_url ? 'Cambiar foto' : 'Subir foto'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {user?.avatar_url && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-[12px] text-muted-foreground hover:text-destructive"
            >
              Quitar
            </button>
          )}
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}

function ProfileCard() {
  const user = useAuthStore((s) => s.user)
  const updateProfile = useUpdateProfile()
  const changePassword = useChangePassword()
  const [name, setName] = useState(user?.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  async function handleSaveName(event: FormEvent) {
    event.preventDefault()
    try {
      await updateProfile.mutateAsync({ name, avatar_url: user?.avatar_url })
    } catch {
      // error mostrado abajo
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault()
    try {
      await changePassword.mutateAsync({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <SettingsCard title="Perfil">
      <AvatarField />
      <form onSubmit={handleSaveName} className="flex flex-col gap-3 max-w-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted-foreground">Nombre completo</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${selectClass} h-9 w-full`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-muted-foreground">Correo electrónico</label>
          <input value={user?.email ?? ''} disabled className={`${selectClass} h-9 w-full`} />
        </div>
        {updateProfile.isError && (
          <p className="text-xs text-destructive">{apiErrorMessage(updateProfile.error)}</p>
        )}
        <button
          type="submit"
          disabled={updateProfile.isPending}
          className="w-fit flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium"
          style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
        >
          <Check size={14} />
          {updateProfile.isPending ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>

      <div className="border-t border-border mt-5 pt-4 flex flex-col gap-3 max-w-sm">
        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">Contraseña actual</label>
            <PasswordInput
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">Nueva contraseña</label>
            <PasswordInput
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          {changePassword.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(changePassword.error)}</p>
          )}
          {changePassword.isSuccess && <p className="text-xs text-primary">Contraseña actualizada.</p>}
          <button
            type="submit"
            disabled={changePassword.isPending}
            className="w-fit flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
          >
            <Check size={14} />
            {changePassword.isPending ? 'Actualizando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </SettingsCard>
  )
}

function SecurityCard() {
  return (
    <SettingsCard title="Seguridad">
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">Autenticación de dos factores</span>
        <ToggleSwitch checked={false} onChange={() => {}} disabled />
      </div>
      <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3 mt-2">
        Próximamente — sesiones activas y 2FA todavía no están implementados.
      </p>
    </SettingsCard>
  )
}

const PAY_CYCLES: PayCycle[] = ['weekly', 'biweekly', 'monthly']
const PAY_CYCLE_LABEL: Record<PayCycle, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
}

const THEME_LABEL: Record<Theme, string> = { dark: 'Oscuro', light: 'Claro' }

function NotificationsAndPreferencesCard() {
  const user = useAuthStore((s) => s.user)
  const updateSettings = useUpdateSettings()
  const { mode, setTheme, isPending: themePending } = useSyncedTheme()

  return (
    <SettingsCard title="Notificaciones y preferencias">
      <div className="flex flex-col">
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-sm">Tema</span>
          <Select value={mode} disabled={themePending} onValueChange={(v) => setTheme((v as Theme) ?? 'dark')}>
            <SelectTrigger className="h-8 w-auto">
              <SelectValue>{(v: Theme) => THEME_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(['dark', 'light'] as Theme[]).map((theme) => (
                <SelectItem key={theme} value={theme}>
                  {THEME_LABEL[theme]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <p className="text-sm">Notificaciones por correo</p>
            <p className="text-xs text-muted-foreground">Reportes, alertas de deuda y presupuesto.</p>
          </div>
          <ToggleSwitch
            checked={user?.email_notifications ?? true}
            disabled={updateSettings.isPending}
            onChange={(checked) => updateSettings.mutate({ email_notifications: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div>
            <p className="text-sm">Notificaciones push</p>
            <p className="text-xs text-muted-foreground">Vencimientos de TDC y pagos próximos.</p>
          </div>
          <ToggleSwitch
            checked={user?.push_notifications ?? true}
            disabled={updateSettings.isPending}
            onChange={(checked) => updateSettings.mutate({ push_notifications: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-3">
          <span className="text-sm">Ciclo de pago</span>
          <Select
            value={user?.pay_cycle ?? 'monthly'}
            disabled={updateSettings.isPending}
            onValueChange={(v) => updateSettings.mutate({ pay_cycle: (v as PayCycle) ?? 'monthly' })}
          >
            <SelectTrigger className="h-8 w-auto">
              <SelectValue>{(v: PayCycle) => PAY_CYCLE_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PAY_CYCLES.map((cycle) => (
                <SelectItem key={cycle} value={cycle}>
                  {PAY_CYCLE_LABEL[cycle]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {updateSettings.isError && (
        <p className="text-xs text-destructive mt-2">{apiErrorMessage(updateSettings.error)}</p>
      )}
    </SettingsCard>
  )
}

function DebtTroubleCard() {
  const user = useAuthStore((s) => s.user)
  const updateSettings = useUpdateSettings()

  return (
    <SettingsCard title="Deudas en problemas">
      <div className="flex items-center justify-between py-1">
        <div className="pr-3">
          <p className="text-sm">Tengo una deuda con problemas de pago</p>
          <p className="text-xs text-muted-foreground">
            Actívalo si tienes un crédito o deuda vencida que no estás pagando. Habilita un registro
            aparte de esa deuda en Deudas y le pide al asesor de IA que te ayude a analizar cómo
            pagarla.
          </p>
        </div>
        <ToggleSwitch
          checked={user?.debt_trouble_mode ?? false}
          disabled={updateSettings.isPending}
          onChange={(checked) => updateSettings.mutate({ debt_trouble_mode: checked })}
        />
      </div>
      {updateSettings.isError && (
        <p className="text-xs text-destructive mt-2">{apiErrorMessage(updateSettings.error)}</p>
      )}
    </SettingsCard>
  )
}

/** Antes vivía como un ícono de escudo aparte en AppSidebar (header móvil +
 * sidebar) -- se movió aquí para no tener un botón de navegación flotando
 * fuera del flujo normal de la app. Solo se renderiza para admins; el guard
 * de verdad sigue siendo el backend + AdminLayout, esto es solo el punto de
 * entrada. */
function AdminAccessCard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  if (user?.role !== 'admin') return null

  return (
    <SettingsCard title="Administración">
      <p className="text-sm text-muted-foreground mb-3">
        Tienes permisos de administrador — gestiona usuarios y consulta métricas globales de la app.
      </p>
      <button
        type="button"
        onClick={() => navigate('/admin')}
        className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] font-medium"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <ShieldCheck size={14} />
        Ir al panel de administración
      </button>
    </SettingsCard>
  )
}

function ConnectedAccountsCard() {
  const user = useAuthStore((s) => s.user)
  const unlinkGoogle = useUnlinkGoogle()
  const isGoogleLinked = user?.auth_provider === 'google'

  return (
    <SettingsCard title="Cuentas conectadas">
      <div className="flex items-center gap-2.5 py-2.5">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="flex-shrink-0">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.3 0-9.9-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.3 5.6-6.2 7.1l6.3 5.3C39.9 37.5 44 31.7 44 24c0-1.3-.1-2.7-.4-3.5z" />
        </svg>
        <span className="text-sm flex-1">Google</span>
        {isGoogleLinked ? (
          <button
            type="button"
            onClick={() => unlinkGoogle.mutate()}
            disabled={unlinkGoogle.isPending}
            className="rounded-full px-2.5 py-0.5 text-[11px] border border-border text-muted-foreground hover:text-destructive"
          >
            Desvincular
          </button>
        ) : (
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px]"
            style={{ background: 'var(--nl-bg-track)', color: 'var(--nl-text-muted)' }}
          >
            No vinculada
          </span>
        )}
      </div>
      {!isGoogleLinked && (
        <p className="text-xs text-muted-foreground">
          Inicia sesión con Google desde la pantalla de login para vincularla a esta cuenta.
        </p>
      )}
      {unlinkGoogle.isError && (
        <p className="text-xs text-destructive mt-1">{apiErrorMessage(unlinkGoogle.error)}</p>
      )}
    </SettingsCard>
  )
}

const GRANULAR_CATEGORIES: DataCategory[] = [
  'transactions',
  'debts',
  'recurring',
  'budgets',
  'insights',
  'reports',
  'notifications',
  'chat',
  'categories',
  'accounts',
]

const CATEGORY_LABEL: Record<DataCategory, string> = {
  transactions: 'Transacciones',
  debts: 'Deudas (lo que debes y lo que te deben)',
  recurring: 'Recurrentes y suscripciones',
  budgets: 'Presupuestos',
  insights: 'Insights',
  reports: 'Reportes generados',
  notifications: 'Notificaciones',
  chat: 'Chat del Asesor IA',
  categories: 'Categorías personalizadas',
  accounts: 'Cuentas bancarias (también borra transacciones y recurrentes)',
}

function DataManagementCard() {
  const eraseData = useEraseData()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<Set<DataCategory>>(new Set())
  const [result, setResult] = useState<DataCategory[] | null>(null)

  function toggle(category: DataCategory) {
    setResult(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  async function run(categories: DataCategory[]) {
    setResult(null)
    try {
      const res = await eraseData.mutateAsync({ categories, password: password || undefined })
      setResult(res.erased)
      setSelected(new Set())
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <SettingsCard title="Borrar datos">
      <p className="text-xs text-muted-foreground mb-3">
        Borra información de tu cuenta por categorías, sin tener que eliminarla por completo. No se
        puede deshacer.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={14} />
          Gestionar borrado de datos
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 max-w-sm">
            <label className="text-[11px] text-muted-foreground">
              Confirma tu contraseña (si tu cuenta usa Google, deja esto vacío)
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Opciones rápidas
            </span>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={eraseData.isPending}
                onClick={() => run(GRANULAR_CATEGORIES.filter((c) => c !== 'accounts'))}
                className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Borrar todo, excepto cuentas
              </button>
              <button
                type="button"
                disabled={eraseData.isPending}
                onClick={() => run(GRANULAR_CATEGORIES)}
                className="flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] font-medium disabled:opacity-50"
                style={{ background: 'var(--nl-danger)', color: '#fff' }}
              >
                <Trash2 size={14} />
                Borrar todo, incluidas cuentas
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Borrado selectivo
            </span>
            <div className="flex flex-col gap-1.5">
              {GRANULAR_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={selected.has(category)}
                    onChange={() => toggle(category)}
                  />
                  {CATEGORY_LABEL[category]}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={eraseData.isPending || selected.size === 0}
              onClick={() => run(Array.from(selected))}
              className="w-fit flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              <Trash2 size={14} />
              {eraseData.isPending ? 'Borrando...' : `Borrar seleccionado (${selected.size})`}
            </button>
          </div>

          {eraseData.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(eraseData.error)}</p>
          )}
          {result && (
            <p className="text-xs" style={{ color: 'var(--nl-accent-ink)' }}>
              Listo: se borró {result.map((c) => CATEGORY_LABEL[c]).join(', ')}.
            </p>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-fit text-xs text-muted-foreground hover:text-foreground"
          >
            Cerrar
          </button>
        </div>
      )}
    </SettingsCard>
  )
}

function DeleteAccountCard() {
  const navigate = useNavigate()
  const deleteAccount = useDeleteAccount()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')

  async function handleDelete(event: FormEvent) {
    event.preventDefault()
    try {
      await deleteAccount.mutateAsync(password || undefined)
      navigate('/login')
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <SettingsCard title="Eliminar cuenta">
      <p className="text-xs text-muted-foreground mb-3">
        Borra el acceso a tu cuenta y cierra todas tus sesiones. No se puede deshacer.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={14} />
          Eliminar mi cuenta
        </button>
      ) : (
        <form onSubmit={handleDelete} className="flex flex-col gap-3 max-w-sm">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted-foreground">
              Confirma tu contraseña (si tu cuenta usa Google, deja esto vacío)
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${selectClass} h-9 w-full`}
            />
          </div>
          {deleteAccount.isError && (
            <p className="text-xs text-destructive">{apiErrorMessage(deleteAccount.error)}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] border border-border text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={deleteAccount.isPending}
              className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium disabled:opacity-60"
              style={{ background: 'var(--nl-danger)', color: '#fff' }}
            >
              <Trash2 size={14} />
              {deleteAccount.isPending ? 'Eliminando...' : 'Eliminar permanentemente'}
            </button>
          </div>
        </form>
      )}
    </SettingsCard>
  )
}

function SessionCard() {
  const navigate = useNavigate()
  const logout = useLogout()

  async function handleLogout() {
    await logout.mutateAsync()
    navigate('/login')
  }

  return (
    <SettingsCard title="Sesión">
      <button
        type="button"
        disabled={logout.isPending}
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 rounded-md border border-border py-2 text-sm text-destructive hover:bg-accent disabled:opacity-50"
      >
        <LogOut size={15} strokeWidth={2} />
        {logout.isPending ? 'Cerrando sesión...' : 'Cerrar sesión'}
      </button>
    </SettingsCard>
  )
}

function SettingsHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Tu perfil y las preferencias de tu cuenta — no configuración de una pantalla en particular, sino
          de toda la app: cómo te ves, cómo te identificas, y cómo entras.
        </p>
      </HelpSection>
      <HelpSection heading="Foto de perfil">
        <p>
          Si entraste con Google, tu foto se importa automáticamente la primera vez. Puedes subir una
          propia cuando quieras — una vez que subes una manual, un futuro login con Google ya no la
          reemplaza.
        </p>
      </HelpSection>
      <HelpSection heading="Tema, notificaciones y ciclo de pago">
        <p>
          El tema (oscuro/claro) se guarda en tu cuenta, no en este navegador — si entras desde otro
          dispositivo, se ve igual. El ciclo de pago (semanal/quincenal/mensual) es el que usan Dashboard y
          Presupuesto para calcular la semana/quincena actual.
        </p>
      </HelpSection>
      <HelpSection heading="Deudas en problemas">
        <p>
          Apagado por default a propósito — actívalo solo si de verdad tienes un crédito o deuda vencida
          que no estás pagando. Habilita una sección aparte en Deudas y le da contexto al Asesor IA para
          que te ayude a analizar cómo salir de ella.
        </p>
      </HelpSection>
      <HelpSection heading="Cuenta de Google">
        <p>
          Si vinculaste Google, aquí puedes desvincularla — pero solo si tu cuenta también tiene
          contraseña; de lo contrario te quedarías sin forma de entrar.
        </p>
      </HelpSection>
      <HelpSection heading="Borrar datos">
        <p>
          Para empezar de cero sin perder tu cuenta: dos botones rápidos ("todo excepto cuentas" o
          "absolutamente todo") y una lista para borrar solo categorías específicas — por ejemplo, solo
          transacciones, o solo el historial del Asesor IA. Borrar cuentas bancarias también borra tus
          transacciones y recurrentes, porque dependen de que la cuenta exista.
        </p>
      </HelpSection>
      <HelpTip>
        Eliminar tu cuenta es permanente: cierra todas tus sesiones y desactiva el acceso. "Borrar datos"
        es distinto — tu login se queda intacto, solo se borra lo que elijas.
      </HelpTip>
    </>
  )
}

export function Settings() {
  return (
    <div>
      <ViewHeader icon={<SettingsIcon />} title="Configuración" help={<SettingsHelp />} />
      <div className="max-w-5xl">
        {/* Cada columna empareja cards de altura parecida a proposito (Perfil
            es la card mas alta de todas, por eso va sola con Seguridad, que
            es la mas corta) -- la vez pasada quedo un hueco enorme cuando una
            columna tenia mucho mas contenido que la otra. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="flex flex-col gap-5">
            <ProfileCard />
            <SecurityCard />
          </div>
          <div className="flex flex-col gap-5">
            <NotificationsAndPreferencesCard />
            <ConnectedAccountsCard />
          </div>
        </div>

        <div className="mt-8">
          <div className="text-[11px] tracking-wide text-muted-foreground font-semibold mb-3">
            FUNCIONES
          </div>
          <div className="flex flex-col gap-5">
            <DebtTroubleCard />
            <AdminAccessCard />
          </div>
        </div>

        {/* Zona de salida -- de menos a mas irreversible. Sesion y Borrar
            datos son parecidas en alto (colapsadas) por eso van pareadas;
            Eliminar cuenta va sola y a todo el ancho, separada del resto a
            proposito -- es la unica accion sin vuelta atras de la pantalla. */}
        <div className="border-t border-border mt-8 pt-6 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <DataManagementCard />
          <SessionCard />
        </div>
        <div className="mt-5">
          <DeleteAccountCard />
        </div>
      </div>
    </div>
  )
}
