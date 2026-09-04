import {
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Pencil,
  Pipette,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DialogFooter, DialogPrimaryButton } from '@/components/nl/DialogActions'
import { HelpSection, HelpTip } from '@/components/nl/Help'
import { HEADER_SECTIONS, SegmentedControl, ViewHeader } from '@/components/nl/primitives'
import {
  CATEGORY_COLOR_CHOICES,
  CATEGORY_ICON_CHOICES,
  CATEGORY_ICON_GROUPS,
  categoryIcon,
  categoryIconLabel,
  getRecentCategoryIcons,
  iconsInGroup,
  matchesIconSearch,
  recordRecentCategoryIcon,
} from '@/lib/categoryIcons'
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

/** The usual swatches + one last "custom" that opens the browser's native
 * color picker (<input type="color">, no libraries) -- the real input
 * stays invisible on top of the circle, so the click opens the OS picker
 * directly, with no dialog of our own to maintain. While the active color
 * isn't any of the fixed swatches, that last dot shows the chosen hex (and
 * the "selected" ring moves there) instead of staying on the inviting
 * gradient. */
function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isCustom = !CATEGORY_COLOR_CHOICES.includes(value)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">Color</label>
      <div className="flex flex-wrap gap-2">
        {CATEGORY_COLOR_CHOICES.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{
              background: color,
              outline: !isCustom && value === color ? '2px solid var(--nl-text-primary)' : 'none',
              outlineOffset: '2px',
            }}
            aria-label={`Color ${color}`}
          />
        ))}
        <label
          className="relative w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center cursor-pointer"
          style={{
            background: isCustom
              ? value
              : 'conic-gradient(from 180deg, #f04e4e, #f5a623, #16a34a, #0891b2, #4e8ef0, #6366f1, #c026d3, #f04e4e)',
            outline: isCustom ? '2px solid var(--nl-text-primary)' : 'none',
            outlineOffset: '2px',
          }}
          title="Elegir cualquier color"
        >
          {!isCustom && <Pipette size={12} color="white" style={{ filter: 'drop-shadow(0 0 1px rgb(0 0 0 / 0.6))' }} />}
          <input
            type="color"
            value={isCustom ? value : '#00c9a7'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Color personalizado"
          />
        </label>
      </div>
    </div>
  )
}

function IconCell({
  iconName,
  selected,
  onSelect,
}: {
  iconName: string
  selected: boolean
  onSelect: (icon: string) => void
}) {
  const Icon = categoryIcon(iconName)
  return (
    <button
      type="button"
      onClick={() => onSelect(iconName)}
      className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
      style={{
        background: selected ? 'var(--nl-accent-soft-bg)' : 'var(--nl-bg-input)',
        color: selected ? 'var(--nl-accent-ink)' : 'var(--nl-text-secondary)',
      }}
      title={categoryIconLabel(iconName)}
    >
      <Icon size={15} />
    </button>
  )
}

/** Search box + "used recently" + a single scroll with sections by topic --
 * replaces the old flat grid (29 icons with no way to find anything, now
 * there are 155). Searching crosses all 8 groups at once, into a flat
 * results grid; without a search, all groups show one below the other in
 * the same scroll (with their header staying sticky while scrolling),
 * instead of a separate panel per selection. The recent ones come from
 * localStorage (see categoryIcons.ts) and aren't filtered by search: they're
 * a fixed shortcut, not another view of the same list. */
function IconGridPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (icon: string) => void
}) {
  const [query, setQuery] = useState('')
  const [recent] = useState(getRecentCategoryIcons)
  const searchResults = query ? CATEGORY_ICON_CHOICES.filter((name) => matchesIconSearch(name, query)) : null
  const totalVisible = searchResults ? searchResults.length : CATEGORY_ICON_CHOICES.length

  function handleSelect(iconName: string) {
    onChange(iconName)
    recordRecentCategoryIcon(iconName)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted-foreground">Ícono</label>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en las 8 categorías… ej. gasolina, café"
          className={`${selectClass} h-8 w-full pl-8 text-[12.5px]`}
        />
      </div>
      {!query && recent.length > 0 && (
        <>
          <div className="text-[10.5px] text-muted-foreground mt-0.5">Usados recientemente</div>
          <div className="grid grid-cols-8 sm:grid-cols-11 gap-1.5">
            {recent.map((iconName) => (
              <IconCell key={iconName} iconName={iconName} selected={value === iconName} onSelect={handleSelect} />
            ))}
          </div>
        </>
      )}
      {searchResults ? (
        <div className="grid grid-cols-8 sm:grid-cols-11 gap-1.5 max-h-[220px] overflow-y-auto -mx-1 px-1">
          {searchResults.map((iconName) => (
            <IconCell key={iconName} iconName={iconName} selected={value === iconName} onSelect={handleSelect} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 max-h-[220px] overflow-y-auto -mx-1 px-1">
          {CATEGORY_ICON_GROUPS.map((g) => (
            <div key={g}>
              <div
                className="sticky top-0 z-[1] flex items-baseline gap-1.5 py-1 text-[10.5px] font-semibold text-muted-foreground"
                style={{ background: 'var(--nl-bg-card)' }}
              >
                {g}
                <span className="font-normal">· {iconsInGroup(g).length}</span>
              </div>
              <div className="grid grid-cols-8 sm:grid-cols-11 gap-1.5">
                {iconsInGroup(g).map((iconName) => (
                  <IconCell key={iconName} iconName={iconName} selected={value === iconName} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10.5px] text-muted-foreground">
        {totalVisible} ícono{totalVisible === 1 ? '' : 's'}
        {query && totalVisible === 0 ? ' — sin resultados' : ''}
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
      // error shown below
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
      <DialogFooter>
        <DialogPrimaryButton icon={Plus} pending={createCategory.isPending}>
          {parentId
            ? 'Crear subcategoría'
            : `Crear categoría de ${type === 'income' ? 'ingreso' : 'gasto'}`}
        </DialogPrimaryButton>
      </DialogFooter>
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
      // error shown below
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
      <DialogFooter>
        <DialogPrimaryButton icon={Check} pending={updateCategory.isPending}>
          Guardar cambios
        </DialogPrimaryButton>
      </DialogFooter>
    </form>
  )
}

/** Stacked bar proportional to each subcategory's expense (plus the
 * uncategorized "remainder", if any) -- at a glance shows how the expense
 * is split, something the card didn't show before. Only makes sense if
 * the parent already has something spent this month; see `showBar` in
 * CategoryCard. */
function SegmentedSpendBar({ segments }: { segments: { color: string; pct: number }[] }) {
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--nl-bg-track)' }}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${s.pct}%`, background: s.color }} />
      ))}
    </div>
  )
}

/** Connects each row to the container's vertical trunk (see `pl-4` + spine
 * in CategoryCard) -- the same "a branch comes off the parent" that used
 * to be hinted at with a simple border-left, now explicit per row. */
function TreeTick() {
  return (
    <span
      className="absolute h-px"
      style={{ left: -13, width: 13, top: '50%', background: 'var(--nl-border)' }}
      aria-hidden="true"
    />
  )
}

function SubcategoryRow({
  category,
  amount,
  percentage,
}: {
  category: Category
  amount: string
  percentage: number | null
}) {
  const deleteCategory = useDeleteCategory()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const [editOpen, setEditOpen] = useState(false)
  const Icon = categoryIcon(category.icon)

  async function handleDelete() {
    const ok = await confirm({
      title: 'Eliminar subcategoría',
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

  return (
    <div className="relative flex items-center gap-2 py-1.5 group">
      <TreeTick />
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: category.color }}
      >
        <Icon size={10} color="white" />
      </span>
      <span className="text-[12px] truncate flex-1">{category.name}</span>
      {percentage !== null && (
        <span className="text-[10.5px] text-muted-foreground tabular-nums w-8 text-right flex-shrink-0">
          {percentage}%
        </span>
      )}
      <span
        className="text-[12px] tabular-nums flex-shrink-0 group-hover:hidden"
        style={{ minWidth: 58, textAlign: 'right' }}
      >
        {formatMoney(amount)}
      </span>
      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0" style={{ minWidth: 58 }}>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger
            render={
              <button
                type="button"
                className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-info/10 hover:text-info"
                title="Editar subcategoría"
              >
                <Pencil size={10} />
              </button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Editar subcategoría</DialogTitle>
            </DialogHeader>
            <EditCategoryForm category={category} onDone={() => setEditOpen(false)} />
          </DialogContent>
        </Dialog>
        <button
          type="button"
          onClick={handleDelete}
          className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Eliminar subcategoría"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  )
}

/** Direct expense on the parent that didn't land in any subcategory --
 * without this the bar would have an unexplained gray segment. It's a
 * calculation, not a real category: no actions or edit dialog. */
function RemainderRow({ amount, percentage }: { amount: number; percentage: number }) {
  return (
    <div className="relative flex items-center gap-2 py-1.5">
      <TreeTick />
      <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'var(--nl-bg-track)' }} />
      <span className="text-[12px] truncate flex-1 text-muted-foreground">Sin subcategoría</span>
      <span className="text-[10.5px] text-muted-foreground tabular-nums w-8 text-right flex-shrink-0">
        {percentage}%
      </span>
      <span className="text-[12px] tabular-nums text-muted-foreground flex-shrink-0" style={{ minWidth: 58, textAlign: 'right' }}>
        {formatMoney(String(amount))}
      </span>
    </div>
  )
}

function AddSubcategoryRow({ parent }: { parent: Category }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center py-1.5">
      <TreeTick />
      <Dialog open={open} onOpenChange={setOpen}>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva subcategoría de {parent.name}</DialogTitle>
          </DialogHeader>
          <NewCategoryForm type={parent.type} parentId={parent.id} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CategoryCard({
  category,
  total,
  subcategories,
  subtotals,
  tourTarget,
}: {
  category: Category
  total: string | undefined
  subcategories?: Category[]
  subtotals?: Map<string, string>
  /** The first card rendered acts as the anchor for the Categories guided
   * tour (see tours.ts) -- not a business prop. */
  tourTarget?: boolean
}) {
  const deleteCategory = useDeleteCategory()
  const deactivateCategory = useDeactivateCategory()
  const confirm = useConfirmStore((s) => s.ask)
  const pushToast = useUiStore((s) => s.pushToast)
  const [editOpen, setEditOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const Icon = categoryIcon(category.icon)
  // Only one level of nesting: only top-level expense categories can have
  // subcategories (see category_service.create_category).
  const canHaveSubcategories = category.parent_id === null && category.type === 'expense'
  const subcategoryList = subcategories ?? []

  // The parent's "spent this month" (`total`) is ONLY its direct expense --
  // unlike the per-category breakdown in Reports, this summary doesn't roll
  // up subcategories (confirmed live: with $300 direct on the parent and
  // $670 on a subcategory, `total` comes in as 300, not 970). The bar needs
  // its own 100%: the parent's direct expense + subcategories, not the
  // parent's `total` alone -- otherwise the percentage goes over 100.
  const parentDirectNum = Number(total ?? '0')
  const subSumNum = subcategoryList.reduce(
    (sum, sub) => sum + Number(subtotals?.get(sub.id) ?? '0'),
    0,
  )
  const combinedTotalNum = parentDirectNum + subSumNum
  const showBar = canHaveSubcategories && subcategoryList.length > 0 && combinedTotalNum > 0
  const segments = showBar
    ? [
        ...subcategoryList.map((sub) => ({
          color: sub.color,
          pct: (Number(subtotals?.get(sub.id) ?? '0') / combinedTotalNum) * 100,
        })),
        ...(parentDirectNum > 0
          ? [{ color: 'var(--nl-bg-track)', pct: (parentDirectNum / combinedTotalNum) * 100 }]
          : []),
      ]
    : []

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
    <div
      className="bg-card border border-border rounded-md p-4 flex flex-col gap-3"
      data-tour={tourTarget ? 'categories:first-card' : undefined}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: category.color }}
        >
          <Icon size={15} color="white" />
        </span>
        <span className="text-[13px] font-medium flex-1 truncate">{category.name}</span>
        {category.is_system ? (
          <div
            className="flex items-center gap-2 flex-shrink-0"
            data-tour={tourTarget ? 'categories:actions' : undefined}
          >
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
          <div
            className="flex items-center gap-2 flex-shrink-0"
            data-tour={tourTarget ? 'categories:actions' : undefined}
          >
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
              <DialogContent className="sm:max-w-lg">
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

      {/* The bar is always visible when there's something to split (not
          behind the toggle) -- gives the "how this is split" signal at a
          glance, without having to expand. The row-by-row list stays
          behind the toggle, same as before. */}
      {showBar && (
        <div data-tour={tourTarget ? 'categories:segbar' : undefined}>
          <SegmentedSpendBar segments={segments} />
        </div>
      )}

      {canHaveSubcategories && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground -mt-1"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {subcategoryList.length > 0
            ? `${subcategoryList.length} subcategoría${subcategoryList.length === 1 ? '' : 's'}`
            : 'Subcategorías'}
        </button>
      )}

      {canHaveSubcategories && expanded && (
        <div className="relative pl-4">
          {/* Tree trunk -- each row (SubcategoryRow/RemainderRow/
              AddSubcategoryRow) draws its own horizontal branch (TreeTick)
              toward this trunk, instead of repeating a card's full chrome
              like before. */}
          <span
            className="absolute w-px"
            style={{ left: 3, top: 0, bottom: 14, background: 'var(--nl-border)' }}
            aria-hidden="true"
          />
          <div className="flex flex-col">
            {subcategoryList.map((sub) => (
              <SubcategoryRow
                key={sub.id}
                category={sub}
                amount={subtotals?.get(sub.id) ?? '0'}
                percentage={
                  combinedTotalNum > 0
                    ? Math.round((Number(subtotals?.get(sub.id) ?? '0') / combinedTotalNum) * 100)
                    : null
                }
              />
            ))}
            {parentDirectNum > 0 && (
              <RemainderRow
                amount={parentDirectNum}
                percentage={Math.round((parentDirectNum / combinedTotalNum) * 100)}
              />
            )}
            <AddSubcategoryRow parent={category} />
          </div>
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
    <div className="mt-6 border border-dashed border-border rounded-md p-4" data-tour="categories:hidden-section">
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
          suma ahí automáticamente. La barra debajo del monto de cada tarjeta compara ese gasto directo
          contra el de sus subcategorías, cada una con su propio color.
        </p>
      </HelpSection>
      <HelpSection heading="Qué pasa con las transacciones">
        <p>
          Al desactivar una categoría de sistema o eliminar una propia (ícono de basura), las
          transacciones que la tenían asignada se quedan sin categoría (no se borran ni se bloquea la
          acción) — podés volver a categorizarlas después si hace falta.
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
        tourKey="categories"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  data-tour="categories:new-button"
                  className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[13px] font-medium"
                  style={{ background: 'var(--nl-accent)', color: 'var(--nl-accent-fg)' }}
                >
                  <Plus size={14} />
                  Nueva categoría
                </button>
              }
            />
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Nueva categoría de {type === 'income' ? 'ingreso' : 'gasto'}</DialogTitle>
              </DialogHeader>
              <NewCategoryForm type={type} onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <div data-tour="categories:type-toggle">
        <SegmentedControl
          value={type}
          onChange={setType}
          options={[
            { value: 'income', label: 'Ingresos' },
            { value: 'expense', label: 'Gastos' },
          ]}
          className="mb-5"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : topLevel.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin categorías todavía.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {topLevel.map((c, i) => (
            <CategoryCard
              key={c.id}
              category={c}
              total={totalsByCategory.get(c.id)}
              subcategories={subcategoriesByParent.get(c.id)}
              subtotals={totalsByCategory}
              tourTarget={i === 0}
            />
          ))}
        </div>
      )}

      <HiddenCategoriesSection type={type} />
    </div>
  )
}
