import { Plus } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { AppSidebar } from '@/components/AppSidebar'
import { TransactionModals } from '@/components/nl/TransactionModals'
import { useTransactionModalStore } from '@/stores/transactionModalStore'

export function Layout() {
  const openQuick = useTransactionModalStore((s) => s.openQuick)

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <AppSidebar />
      <div className="flex-1 min-w-0 lg:min-h-0 flex flex-col">
        {/* flex flex-col ademas de flex-1: no cambia nada para la mayoria de
            las pantallas (su root div sigue sizeando a su contenido, como
            antes), pero le da a Advisor.tsx un `lg:flex-1 lg:min-h-0` real
            para llenar el alto disponible SIN necesitar un `calc(100vh-Npx)`
            a mano ni bleed-ear el padding -- asi su chat queda con el mismo
            gutter que cualquier otra pantalla.

            El `lg:h-screen` de arriba (en vez de solo min-h-screen) es lo
            que de verdad hace el truco, no el min-h-0 solo: min-height NO le
            da a los descendientes flex un tamaño DEFINIDO del cual encoger
            -- sin una altura definida en algun punto de la cadena, el
            "minimo automatico 0" de un item con overflow-auto nunca se
            llega a aplicar de verdad (nunca hay una negociacion real de
            encoger), y todo termina renderizando a su alto de contenido de
            todas formas, empujando la pagina entera. Para paginas normales
            (que SI quieren poder crecer mas de 100vh y hacer scroll normal)
            no cambia nada: si su contenido es mas alto que 100vh, igual
            se desborda visualmente hacia abajo (nada aqui tiene
            overflow-hidden) y el scroll de pagina de siempre sigue
            funcionando igual -- h-screen vs min-h-screen solo importa
            para el calculo de flexbox interno, no para el overflow visible. */}
        <main
          // pb-20 (en vez de solo p-4) deja espacio de sobra abajo en movil para
          // que el FAB "Agregar rapido" (fixed bottom-5, ver mas abajo) nunca
          // quede encima de contenido real al hacer scroll hasta el fondo --
          // confirmado con el calendario de Transacciones, donde sin este
          // padding el FAB tapaba los ultimos dias del mes.
          className="flex-1 lg:min-h-0 flex flex-col p-4 pt-4 pb-20 lg:p-8 lg:pt-7 lg:pb-8 max-w-[1600px] w-full mx-auto overflow-x-hidden"
          style={{ animation: 'fadeInView 150ms ease' }}
        >
          <Outlet />
        </main>
      </div>

      <button
        type="button"
        onClick={openQuick}
        title="Agregar rápido"
        className="fixed bottom-5 right-5 lg:bottom-8 lg:right-10 w-[48px] h-[48px] lg:w-[52px] lg:h-[52px] rounded-full flex items-center justify-center z-30"
        style={{
          background: 'var(--nl-accent)',
          color: 'var(--nl-accent-fg)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        }}
      >
        <Plus size={22} strokeWidth={2.2} />
      </button>

      <TransactionModals />
    </div>
  )
}
