import { Target } from 'lucide-react'
import { HEADER_SECTIONS, ViewHeader } from '@/components/nl/primitives'

export function Goals() {
  return (
    <div>
      <ViewHeader icon={<Target />} title="Metas" section={HEADER_SECTIONS.diario} />
      <div className="bg-card border border-dashed border-border rounded-md p-10 text-center flex flex-col items-center gap-3">
        <Target size={32} className="text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground max-w-md">
          Próximamente — las metas de ahorro (por ejemplo, un enganche o un fondo de emergencia) todavía
          no son un módulo del backend. Cuando se construya, aquí podrás definir un monto objetivo, una
          aportación mensual, y ver la proyección de cuándo la alcanzas.
        </p>
      </div>
    </div>
  )
}
