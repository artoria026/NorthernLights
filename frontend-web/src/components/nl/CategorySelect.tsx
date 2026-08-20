import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronDown, Search } from 'lucide-react'
import { categoryIcon } from '@/lib/categoryIcons'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

/** Reemplazo de <Select> para elegir categoría/subcategoría -- un <Select>
 * plano no dice a qué padre pertenece cada subcategoría. Aquí las
 * subcategorías quedan agrupadas debajo de su padre (con encabezado), y se
 * puede filtrar escribiendo el nombre de cualquiera de los dos. `useCategories`
 * ya trae padres e hijos en una sola lista plana (con `parent_id`), así que
 * arma los grupos una sola vez por render en vez de requerir que el caller
 * los pre-procese. */

interface CategorySelectProps {
  categories: Category[] | undefined
  value: string | null | undefined
  onValueChange: (categoryId: string) => void
  placeholder?: string
  triggerClassName?: string
  disabled?: boolean
}

interface CategoryGroup {
  parent: Category
  /** [padre, ...hijos] -- el padre va primero para poder elegirlo como "sin
   * subcategoría" sin salir del grupo. Si no tiene hijos, queda solo el. */
  items: Category[]
}

function CategorySwatch({ category, size = 18 }: { category: Category; size?: number }) {
  const Icon = categoryIcon(category.icon)
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px]"
      style={{ background: category.color, width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.6)} color="white" strokeWidth={2} />
    </span>
  )
}

export function CategorySelect({
  categories,
  value,
  onValueChange,
  placeholder = 'Selecciona...',
  triggerClassName,
  disabled,
}: CategorySelectProps) {
  const flat = categories ?? []
  const parentById = new Map(flat.filter((c) => !c.parent_id).map((c) => [c.id, c]))
  const selected = flat.find((c) => c.id === value) ?? null

  const childrenByParent = new Map<string, Category[]>()
  for (const c of flat) {
    if (!c.parent_id) continue
    const list = childrenByParent.get(c.parent_id) ?? []
    list.push(c)
    childrenByParent.set(c.parent_id, list)
  }
  const groups: CategoryGroup[] = flat
    .filter((c) => !c.parent_id)
    .map((parent) => ({ parent, items: [parent, ...(childrenByParent.get(parent.id) ?? [])] }))

  return (
    <Combobox.Root<Category>
      items={groups}
      value={selected}
      onValueChange={(next) => onValueChange(next?.id ?? '')}
      isItemEqualToValue={(a, b) => a.id === b.id}
      itemToStringLabel={(c) => c.name}
      filter={(cat, query) => {
        const q = query.trim().toLowerCase()
        if (!q) return true
        const parent = cat.parent_id ? parentById.get(cat.parent_id) : undefined
        return cat.name.toLowerCase().includes(q) || (!!parent && parent.name.toLowerCase().includes(q))
      }}
      disabled={disabled}
    >
      <Combobox.Trigger
        aria-label={placeholder}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-placeholder:text-muted-foreground',
          triggerClassName,
        )}
      >
        <Combobox.Value placeholder={placeholder}>
          {(cat: Category | null) =>
            cat ? (
              <span className="flex min-w-0 items-center gap-2">
                <CategorySwatch category={cat} size={16} />
                <span className="truncate">{cat.name}</span>
              </span>
            ) : (
              placeholder
            )
          }
        </Combobox.Value>
        <Combobox.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown size={14} />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Combobox.Popup className="flex w-[var(--anchor-width)] min-w-[260px] flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
              <Search size={13} className="shrink-0 text-muted-foreground" />
              <Combobox.Input
                placeholder="Buscar categoría..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {/* Combobox.Empty siempre queda montado en el DOM (incluso sin
                resultados que mostrar, ver nota de accesibilidad en sus
                docs) -- sin `empty:hidden` su padding deja una barra en
                blanco arriba de la lista aunque SI haya resultados, porque
                el div solo se vacia de texto, nunca se desmonta. */}
            <Combobox.Empty className="empty:hidden px-3 py-6 text-center text-xs text-muted-foreground">
              Sin resultados
            </Combobox.Empty>
            <Combobox.List className="max-h-64 overflow-y-auto p-1">
              {(group: CategoryGroup) => {
                const hasChildren = group.items.length > 1
                return (
                  <Combobox.Group
                    key={group.parent.id}
                    items={group.items}
                    // data-list-empty se marca cuando el filtro no dejo
                    // ningun item del grupo -- sin esto el grupo entero
                    // (encabezado incluido) queda montado vacio, mismo bug
                    // que Combobox.Empty de arriba pero por grupo.
                    className="data-[list-empty]:hidden mb-1 last:mb-0"
                  >
                    {hasChildren && (
                      <Combobox.GroupLabel className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        <CategorySwatch category={group.parent} size={13} />
                        {group.parent.name}
                      </Combobox.GroupLabel>
                    )}
                    <Combobox.Collection>
                      {(cat: Category) => {
                        const isParentRow = hasChildren && cat.id === group.parent.id
                        return (
                          <Combobox.Item
                            key={cat.id}
                            value={cat}
                            className="relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-6 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                          >
                            <CategorySwatch category={cat} size={hasChildren ? 15 : 18} />
                            <span
                              className={cn('min-w-0 flex-1 truncate', isParentRow && 'text-muted-foreground italic')}
                            >
                              {isParentRow ? 'General' : cat.name}
                            </span>
                            <Combobox.ItemIndicator className="absolute right-2 flex items-center text-primary">
                              <Check size={14} />
                            </Combobox.ItemIndicator>
                          </Combobox.Item>
                        )
                      }}
                    </Combobox.Collection>
                  </Combobox.Group>
                )
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
