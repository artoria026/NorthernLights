import { Check, ChevronDown, ChevronRight, EyeOff, Pencil, Plus, RotateCcw, Tag, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import { CATEGORY_COLOR_CHOICES, CATEGORY_ICON_CHOICES, categoryIcon } from '@/lib/categoryIcons'
import {
  useCategories,
  useCategorySummary,
  useCreateCategory,
  useDeactivateCategory,
  useDeleteCategory,
  useHiddenCategories,
  useReactivateCategory,
  useUpdateCategory,
} from '@/hooks/useCategories'
import { apiErrorMessage } from '@/services/api'
import { formatMoney, selectClass } from '@/lib/utils'
import { useConfirmStore } from '@/stores/confirmStore'
import { useUiStore } from '@/stores/uiStore'
import type { Category } from '@/types'

type CatType = 'income' | 'expense'

function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">Color</label>
      <div className="flex gap-2">
        {CATEGORY_COLOR_CHOICES.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{
              background: color,
              outline: value === color ? '2px solid var(--nl-text-primary)' : 'none',
              outlineOffset: '2px',
            }}
            aria-label={`Color ${color}`}
          />
        ))}
      </div>
    </div>
  )
}

function IconGridPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (icon: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">Ícono</label>
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 max-h-[140px] overflow-y-auto -mx-1 px-1">
        {CATEGORY_ICON_CHOICES.map((iconName) => {
          const Icon = categoryIcon(iconName)
          const selected = value === iconName
          return (
            <button
              key={iconName}
              type="button"
              onClick={() => onChange(iconName)}
              className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
              style={{
                background: selected ? 'var(--nl-accent-soft-bg)' : 'var(--nl-bg-input)',
                color: selected ? 'var(--nl-accent-ink)' : 'var(--nl-text-secondary)',
              }}
              title={iconName}
            >
              <Icon size={15} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NewCategoryForm({
  type,
  parentId,
  onDone,
}: {
  type: CatType
  parentId?: string
  onDone: () => void
}) {
  const createCategory = useCreateCategory()
  const [name, setName] = useState('')
  const [color, setColor] = useState(CATEGORY_COLOR_CHOICES[0])
  const [icon, setIcon] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    try {
      await createCategory.mutateAsync({
        name: name.trim(),
        type,
        color,
        icon: icon ?? undefined,
        parent_id: parentId,
      })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          placeholder={type === 'income' ? 'Ej: Freelance' : 'Ej: Mascotas'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <ColorSwatchPicker value={color} onChange={setColor} />
      <IconGridPicker value={icon} onChange={setIcon} />
      {createCategory.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(createCategory.error)}</p>
      )}
      <button
        type="submit"
        disabled={createCategory.isPending}
        className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <Plus size={14} />
        {createCategory.isPending
          ? 'Guardando...'
          : parentId
            ? 'Crear subcategoría'
            : `Crear categoría de ${type === 'income' ? 'ingreso' : 'gasto'}`}
      </button>
    </form>
  )
}

function EditCategoryForm({ category, onDone }: { category: Category; onDone: () => void }) {
  const updateCategory = useUpdateCategory()
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color)
  const [icon, setIcon] = useState<string | null>(category.icon)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    try {
      await updateCategory.mutateAsync({
        id: category.id,
        input: { name: name.trim(), color, icon: icon ?? undefined },
      })
      onDone()
    } catch {
      // error mostrado abajo
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Nombre</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${selectClass} h-9 w-full`}
        />
      </div>
      <ColorSwatchPicker value={color} onChange={setColor} />
      <IconGridPicker value={icon} onChange={setIcon} />
      {updateCategory.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(updateCategory.error)}</p>
      )}
      <button
        type="submit"
        disabled={updateCategory.isPending}
        className="flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-medium"
        style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
      >
        <Check size={14} />
        {updateCategory.isPending ? 'Guardando...' : 'Guardar cambios'}
      </button>
    </form>
  )
}

function CategoryCard({
  category,
  total,
  subcategories,
  subtotals,
}: {
  category: Category
  total: string | undefined
  subcategories?: Category[]
  subtotals?: Map<string, string>
}) {
  const deleteCategory = useDeleteCategory()
  const deactivateCategory = useDeactivateCategory()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const [editOpen, setEditOpen] = useState(false)
  const [addSubOpen, setAddSubOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const Icon = categoryIcon(category.icon)
  // Un solo nivel de anidamiento: solo las categorias de primer nivel de
  // gasto pueden tener subcategorias (ver category_service.create_category).
  const canHaveSubcategories = category.parent_id === null && category.type === 'expense'

  async function handleDelete() {
    const ok = await confirm({
      title: 'Eliminar categoría',
      message: `¿Eliminar "${category.name}"? Las transacciones que la usan se quedan sin categoría. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteCategory.mutateAsync(category.id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  async function handleDeactivate() {
    const ok = await confirm({
      title: 'Desactivar categoría',
      message: `¿Desactivar "${category.name}" para ti? Dejará de aparecer en tu lista y tus transacciones que la usan se quedan sin categoría -- podés reactivarla cuando quieras, solo te afecta a ti.`,
      confirmLabel: 'Desactivar',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deactivateCategory.mutateAsync(category.id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: category.color }}
        >
          <Icon size={15} color="white" />
        </span>
        <span className="text-[13px] font-medium flex-1 truncate">{category.name}</span>
        {category.is_system ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground">Sistema</span>
            <button
              type="button"
              onClick={handleDeactivate}
              className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Desactivar para mí"
            >
              <EyeOff size={12} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
                    title="Editar categoría"
                  >
                    <Pencil size={12} />
                  </button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Editar categoría</DialogTitle>
                </DialogHeader>
                <EditCategoryForm category={category} onDone={() => setEditOpen(false)} />
              </DialogContent>
            </Dialog>
            <button
              type="button"
              onClick={handleDelete}
              className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Eliminar categoría"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {category.type === 'income' ? 'Recibido' : 'Gastado'} este mes
      </div>
      <div
        className="text-[15px] font-medium"
        style={{ color: category.type === 'income' ? 'var(--nl-accent-ink)' : undefined }}
      >
        {formatMoney(total ?? '0')}
      </div>

      {canHaveSubcategories && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground -mt-1"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {subcategories && subcategories.length > 0
            ? `${subcategories.length} subcategoría${subcategories.length === 1 ? '' : 's'}`
            : 'Subcategorías'}
        </button>
      )}

      {canHaveSubcategories && expanded && (
        <div className="flex flex-col gap-2 pl-3 border-l border-border">
          {subcategories?.map((sub) => (
            <CategoryCard key={sub.id} category={sub} total={subtotals?.get(sub.id)} />
          ))}
          <Dialog open={addSubOpen} onOpenChange={setAddSubOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  <Plus size={12} />
                  Subcategoría
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva subcategoría de {category.name}</DialogTitle>
              </DialogHeader>
              <NewCategoryForm
                type={category.type}
                parentId={category.id}
                onDone={() => setAddSubOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  )
}

function HiddenCategoriesSection({ type }: { type: CatType }) {
  const { data: hidden } = useHiddenCategories(type)
  const reactivateCategory = useReactivateCategory()
  const pushToast = useUiStore((s) => s.pushToast)

  if (!hidden || hidden.length === 0) return null

  async function handleReactivate(id: string) {
    try {
      await reactivateCategory.mutateAsync(id)
    } catch (error) {
      pushToast(apiErrorMessage(error), 'error')
    }
  }

  return (
    <div className="mt-6 border border-dashed border-border rounded-md p-4">
      <p className="text-[12px] font-medium text-muted-foreground mb-3">
        Categorías desactivadas (solo para ti)
      </p>
      <div className="flex flex-col gap-2">
        {hidden.map((category) => {
          const Icon = categoryIcon(category.icon)
          return (
            <div key={category.id} className="flex items-center gap-2.5">
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 opacity-60"
                style={{ background: category.color }}
              >
                <Icon size={13} color="white" />
              </span>
              <span className="text-[13px] flex-1 truncate text-muted-foreground">
                {category.name}
              </span>
              <button
                type="button"
                onClick={() => handleReactivate(category.id)}
                className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground flex-shrink-0"
                title="Reactivar"
              >
                <RotateCcw size={12} />
                Reactivar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CategoriasHelp() {
  return (
    <>
      <HelpSection heading="Qué es esta pantalla">
        <p>
          Las categorías con las que clasificas tus ingresos y gastos. Cada tarjeta muestra cuánto llevas
          recibido o gastado en esa categoría durante el mes actual.
        </p>
      </HelpSection>
      <HelpSection heading="Sistema vs. tuyas">
        <p>
          Las categorías marcadas <strong>Sistema</strong> vienen predefinidas y no se pueden editar ni
          eliminar (garantizan que siempre haya dónde clasificar un movimiento), pero sí las podés{' '}
          <strong>desactivar</strong> para ti con el ícono del ojo tachado si no las usas — dejan de
          aparecer en tu lista y podés reactivarlas cuando quieras desde la sección de abajo; a los demás
          usuarios no les afecta. Las que tú creas sí se pueden renombrar, cambiar de color/ícono, o
          eliminar con la "×".
        </p>
      </HelpSection>
      <HelpSection heading="Subcategorías">
        <p>
          Las categorías de gasto de primer nivel pueden tener subcategorías (ej. "Restaurantes" y
          "Supermercado" dentro de "Comida y Bebidas") — desplegá la categoría para verlas o agregar una
          nueva. Solo se permite un nivel: una subcategoría no puede tener subcategorías propias. El
          presupuesto mensual siempre se define en la categoría padre; lo que gastes en sus subcategorías
          suma ahí automáticamente.
        </p>
      </HelpSection>
      <HelpSection heading="Qué pasa con las transacciones">
        <p>
          Al desactivar una categoría de sistema o eliminar una propia, las transacciones que la tenían
          asignada se quedan sin categoría (no se borran ni se bloquea la acción) — podés volver a
          categorizarlas después si hace falta.
        </p>
      </HelpSection>
      <HelpTip>
        Nunca eliges una cuenta contable al usar una categoría en una transacción — el sistema la resuelve
        sola por dentro. Aquí solo administras el catálogo de nombres.
      </HelpTip>
    </>
  )
}

export function Categorias() {
  const [type, setType] = useState<CatType>('expense')
  const [open, setOpen] = useState(false)
  const { data: categories, isLoading } = useCategories(type)
  const { data: summary } = useCategorySummary()

  const totalsByCategory = new Map((summary ?? []).map((s) => [s.category_id, s.total]))
  const topLevel = (categories ?? []).filter((c) => c.parent_id === null)
  const subcategoriesByParent = new Map<string, Category[]>()
  for (const c of categories ?? []) {
    if (c.parent_id === null) continue
    const list = subcategoriesByParent.get(c.parent_id) ?? []
    list.push(c)
    subcategoriesByParent.set(c.parent_id, list)
  }

  return (
    <div>
      <ViewHeader
        icon={<Tag />}
        title="Categorías"
        help={<CategoriasHelp />}
        section={HEADER_SECTIONS.diario}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  Nueva categoría
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva categoría de {type === 'income' ? 'ingreso' : 'gasto'}</DialogTitle>
              </DialogHeader>
              <NewCategoryForm type={type} onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <SegmentedControl
        value={type}
        onChange={setType}
        options={[
          { value: 'income', label: 'Ingresos' },
          { value: 'expense', label: 'Gastos' },
        ]}
        className="mb-5"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : topLevel.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin categorías todavía.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {topLevel.map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              total={totalsByCategory.get(c.id)}
              subcategories={subcategoriesByParent.get(c.id)}
              subtotals={totalsByCategory}
            />
          ))}
        </div>
      )}

      <HiddenCategoriesSection type={type} />
    </div>
  )
}
