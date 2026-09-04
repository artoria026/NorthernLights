/** Content registry for the guided tour (Welcome + focus tour,
 * "Proposal 5" -- see recorridos-propuestas.html at the repo root, which
 * tested the visual mechanics before it was ported here). One entry per
 * module; modules that don't have an entry yet simply don't show the tour
 * button or the welcome modal (see ViewHeader in primitives.tsx) -- so the
 * rollout is incremental without touching types.
 *
 * Several `steps` are conditional (banners, charts that only appear with
 * data, buttons behind a Settings toggle) -- tourStore filters out, when
 * starting the tour, the ones that have no selector in the DOM at that
 * moment, so a user without that data still sees a complete tour, just
 * shorter. That's why NO step here may live inside the content of a closed
 * Dialog/modal -- that selector never exists until the user opens the
 * dialog by hand, and the step would always be left out of the tour. Only
 * trigger buttons (DialogTrigger) or content that's already on screen get
 * anchored. Anything that only lives inside a form (e.g. the "interest-free
 * installments" checkbox in New transaction) is explained as text inside a
 * neighboring step that does have a real anchor. */

export type ModuleKey =
  | 'dashboard'
  | 'advisor'
  | 'accounts'
  | 'transactions'
  | 'budget'
  | 'debts'
  | 'recurring'
  | 'subscriptions'
  | 'insights'
  | 'categories'
  | 'reports'
  | 'settings'
  | 'notifications'

export interface TourStepContent {
  /** CSS selector of a real element on screen, via the
   * `data-tour="<moduleKey>:<element>"` attribute. */
  selector: string
  title: string
  text: string
}

export interface TourContent {
  welcome: {
    description: string
    bullets: string[]
  }
  steps: TourStepContent[]
}

export const TOUR_CONTENT: Partial<Record<ModuleKey, TourContent>> = {
  dashboard: {
    welcome: {
      description:
        'Un resumen del estado general de tus finanzas: cuánto dinero líquido tienes, cuánto debes en tarjetas, qué tan cerca estás de tu presupuesto y qué pagos se acercan.',
      bullets: [
        'Ve tu liquidez y deuda revolvente de un vistazo',
        'Compara tu gasto contra el presupuesto del mes y de la semana',
        'Revisa qué pagos vencen pronto antes de que te agarren desprevenido',
      ],
    },
    steps: [
      {
        selector: '[data-tour="dashboard:liquidity"]',
        title: 'Tu dinero disponible',
        text: 'Suma el saldo de tus cuentas tipo efectivo/banco -- no incluye tarjetas de crédito, esas son deuda, no liquidez.',
      },
      {
        selector: '[data-tour="dashboard:due-soon"]',
        title: 'Pagos en los próximos 3 días',
        text: 'Junta recurrentes y pagos de deudas que vencen muy pronto -- solo aparece cuando hay algo así de cerca.',
      },
      {
        selector: '[data-tour="dashboard:budget"]',
        title: 'Qué tan cerca vas del límite',
        text: 'El color cambia de verde a naranja a rojo según qué porcentaje de tu presupuesto del mes ya gastaste.',
      },
      {
        selector: '[data-tour="dashboard:month-summary"]',
        title: 'Ingresos y gastos del mes',
        text: 'Solo aparecen una vez que generas el reporte del mes en Reportes -- comparados contra el mes anterior.',
      },
      {
        selector: '[data-tour="dashboard:cashflow"]',
        title: 'Flujo de caja de la semana',
        text: 'Ingresos vs. gastos de los últimos 7 días, para notar rápido si esta semana estás gastando más de lo que entra.',
      },
      {
        selector: '[data-tour="dashboard:networth"]',
        title: 'Patrimonio neto',
        text: 'Une los reportes mensuales que ya generaste -- necesitas al menos 2 meses de reportes para ver la línea de tendencia.',
      },
      {
        selector: '[data-tour="dashboard:insights-preview"]',
        title: 'Insights destacados',
        text: 'Las observaciones más relevantes que generó el análisis automático -- click para verlas todas en Insights.',
      },
      {
        selector: '[data-tour="dashboard:upcoming"]',
        title: 'Próximos pagos',
        text: 'Junta tus gastos recurrentes activos con los pagos de deudas que vencen en los próximos días, para que nada te tome por sorpresa.',
      },
    ],
  },
  accounts: {
    welcome: {
      description:
        'Tus cuentas reales: bancos, efectivo y tarjetas de crédito. El patrimonio neto se calcula sumando el saldo de todas ellas.',
      bullets: [
        'Registra cuentas bancarias, de ahorro, efectivo o tarjetas de crédito',
        'Personaliza cada una con logo y color',
        'Revisa el historial de movimientos de cualquier cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="accounts:new-button"]',
        title: 'Agrega una cuenta',
        text: 'Bancaria, de ahorro, efectivo o tarjeta de crédito -- esta última se registra como un pasivo (lo que debes), no como dinero disponible. No es lo mismo que una Deuda: eso es para préstamos, no para tarjetas.',
      },
      {
        selector: '[data-tour="accounts:list"]',
        title: 'Activos y pasivos',
        text: 'Tus cuentas se agrupan en Activos (dinero tuyo) y Pasivos (tarjetas de crédito). El patrimonio neto de abajo es la resta de ambos.',
      },
      {
        selector: '[data-tour="accounts:detail"]',
        title: 'Movimientos de la cuenta',
        text: 'Selecciona cualquier cuenta a la izquierda para ver aquí su historial completo, con buscador y filtro de entradas/salidas. Editar el saldo inicial de una cuenta con movimientos recalcula el saldo actual y te lo confirma antes.',
      },
      {
        selector: '[data-tour="accounts:tdc-cycle"]',
        title: 'Ciclo de tu tarjeta',
        text: 'Día de corte, límite de pago, saldo del ciclo actual y crédito disponible -- vienen de los datos que le diste a la tarjeta al crearla. Si tienes compras a meses sin intereses activas, aquí mismo ves cuántas y cuánto comprometen este mes, y cada una trae un sello "MSI pagadas/total" en su fila del historial.',
      },
      {
        selector: '[data-tour="accounts:actions"]',
        title: 'Editar, pagar, conciliar o eliminar',
        text: 'Editar cambia los datos de la cuenta. En una tarjeta de crédito, "Pagar tarjeta" registra una transferencia real desde cualquier otra cuenta -- ese es el único lugar donde se le paga, ya no existe como una Deuda aparte. Conciliar saldo (solo cuentas líquidas) ajusta la diferencia entre lo que registraste y lo real creando una transacción visible -- úsalo cuando el saldo no cuadra, no para corregir el saldo inicial. Eliminar es permanente.',
      },
    ],
  },
  transactions: {
    welcome: {
      description:
        'El historial completo de tus movimientos: ingresos, gastos, transferencias y préstamos. Puedes filtrar por cuenta, tipo, fecha o texto.',
      bullets: [
        'Registra ingresos, gastos y transferencias entre cuentas',
        'Divide un gasto compartido y cobra tu parte después',
        'Filtra por cuenta, texto o un día específico del calendario',
      ],
    },
    steps: [
      {
        selector: '[data-tour="transactions:new-button"]',
        title: 'Registra un movimiento',
        text: 'Para ingreso o gasto solo eliges cuenta, categoría y monto -- la app resuelve sola la contraparte contable. Si el gasto es con una tarjeta de crédito, aparece la opción "¿A meses sin intereses?" para marcarlo a MSI y ver su progreso después en Cuentas.',
      },
      {
        selector: '[data-tour="transactions:pay-card-button"]',
        title: 'Pagar una tarjeta',
        text: 'Registra el pago desde cualquier otra cuenta tuya, sin salir de Transacciones -- solo aparece si tienes al menos una tarjeta de crédito registrada. Si tienes varias, primero eliges cuál.',
      },
      {
        selector: '[data-tour="transactions:split-button"]',
        title: 'Gasto compartido',
        text: 'Registra el cargo total, tu parte real y la de cada persona -- lo que le corresponde a cada quien queda como "me deben" en Deudas. Una vez creado, ya no se puede editar (solo eliminar), por tener más de dos movimientos internos.',
      },
      {
        selector: '[data-tour="transactions:filters"]',
        title: 'Encuentra lo que buscas',
        text: 'Busca por texto o filtra por cuenta -- la lista de abajo se actualiza al momento.',
      },
      {
        selector: '[data-tour="transactions:sort"]',
        title: 'Ordena por fecha',
        text: 'Click en el encabezado invierte el orden entre más reciente y más antiguo primero.',
      },
      {
        selector: '[data-tour="transactions:row-actions"]',
        title: 'Editar o eliminar',
        text: 'Algunas transacciones (como las de gasto compartido) ya no se pueden editar, solo eliminar -- si falta el lápiz, es por eso.',
      },
      {
        selector: '[data-tour="transactions:calendar"]',
        title: 'Vista de calendario',
        text: 'Los mismos datos como calendario -- haz click en un día para filtrar la lista automáticamente a ese día, y otra vez para quitar el filtro.',
      },
    ],
  },
  budget: {
    welcome: {
      description:
        'Cuánto planeas gastar por categoría de gasto variable (comida, transporte, etc.) cada mes, contra lo que realmente llevas gastado.',
      bullets: [
        'Ponle un tope mensual a cualquier categoría, es opcional una por una',
        'Recibe una sugerencia de límite basada en tu gasto promedio',
        'Navega meses pasados para ver cómo te fue',
      ],
    },
    steps: [
      {
        selector: '[data-tour="budget:new-limit"]',
        title: 'Define un límite',
        text: 'Si no le pones límite a ninguna categoría, no aparece nada en el desglose -- es opcional, categoría por categoría.',
      },
      {
        selector: '[data-tour="budget:suggestion"]',
        title: 'Sugerencia automática',
        text: 'Cuando tu gasto promedio de los últimos 3 meses se aleja de tu límite actual, aparece este atajo para igualarlo con un click.',
      },
      {
        selector: '[data-tour="budget:available"]',
        title: 'Lo que te queda',
        text: 'Ingreso estimado menos comprometido fijo (deudas y recurrentes) menos gastado. En rojo si ya te pasaste.',
      },
      {
        selector: '[data-tour="budget:committed"]',
        title: 'Comprometido fijo',
        text: 'La suma de tus deudas y recurrentes activos -- dinero que ya sabes que vas a gastar este mes, sin importar el presupuesto variable.',
      },
      {
        selector: '[data-tour="budget:alerts"]',
        title: 'Categorías cerca del límite',
        text: 'Solo aparece si algo se está por pasar -- un aviso rápido sin tener que revisar categoría por categoría.',
      },
      {
        selector: '[data-tour="budget:distribution"]',
        title: 'Distribución de gasto',
        text: 'Cómo se reparte lo gastado este mes entre tus categorías con límite.',
      },
      {
        selector: '[data-tour="budget:trend"]',
        title: 'Tendencia de hasta 12 meses',
        text: '% de tu presupuesto usado mes a mes -- útil para ver si vas mejorando o empeorando con el tiempo.',
      },
      {
        selector: '[data-tour="budget:month-nav"]',
        title: 'Revisa meses anteriores',
        text: 'La vista semanal y la alerta de límite solo aplican al mes en curso -- un mes cerrado ya no tiene "semana actual".',
      },
    ],
  },
  debts: {
    welcome: {
      description:
        'Todo lo que involucra deber dinero, en cualquier dirección: préstamos personales, formales o informales, o algo tan informal como prestarle $100 a un amigo. Las tarjetas de crédito viven en Cuentas -- ahí se pagan y se ve el progreso de tus compras a meses.',
      bullets: [
        'Registra deudas con su plan completo: monto, frecuencia y cuenta',
        'Cambia entre "Yo debo" y "Me deben" -- misma pantalla, distinta dirección',
        'Registra pagos/cobros reales que mueven dinero de una cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="debts:new-button"]',
        title: 'Registra una deuda',
        text: 'Tipo (préstamo personal, de nómina, informal, cívico o recibido), monto, cuota/frecuencia y, si aplica, de/a qué cuenta se movió el efectivo cuando se originó -- opcional, para una deuda que ya traías antes de usar la app.',
      },
      {
        selector: '[data-tour="debts:unplanned-button"]',
        title: 'Deuda sin plan',
        text: 'Para una deuda vencida o sin estructura clara: solo nombre y monto. Solo aparece si activaste "Tengo una deuda con problemas de pago" en Ajustes.',
      },
      {
        selector: '[data-tour="debts:activate-button"]',
        title: 'Activarla cuando tengas un plan',
        text: 'Convierte una deuda sin plan en una con estructura completa (monto, frecuencia, cuenta) -- puedes aplicarle una quita si negociaste el monto.',
      },
      {
        selector: '[data-tour="debts:direction-toggle"]',
        title: 'Dos direcciones, misma pantalla',
        text: '"Yo debo" y "Me deben" usan el mismo modelo -- solo cambia quién le debe a quién.',
      },
      {
        selector: '[data-tour="debts:correct-balance"]',
        title: 'Corregir saldo vs. registrar pago',
        text: 'Corregir saldo ajusta el número sin mover dinero real -- útil al cargar historial viejo. Registrar pago/cobro sí mueve dinero de una cuenta.',
      },
      {
        selector: '[data-tour="debts:summary"]',
        title: 'Tu panorama de deuda',
        text: 'El total pendiente y, si aplica, cuánto de eso está comprometido cada mes. Una tarjeta con borde rojo señala una TAE por encima del 25%.',
      },
    ],
  },
  recurring: {
    welcome: {
      description:
        'Gastos e ingresos que se repiten en un ciclo fijo -- servicios, utilities e ingresos recurrentes como una nómina. Las suscripciones (streaming, software) tienen su propia página y no aparecen aquí.',
      bullets: [
        'Registra un recurrente y define su frecuencia de cobro',
        'Confirma o rechaza cada movimiento antes de que cuente como real',
        'Revisa qué se cobra en los próximos 7 días',
      ],
    },
    steps: [
      {
        selector: '[data-tour="recurring:new-button"]',
        title: 'Agrega un recurrente',
        text: 'Servicios, utilities o un ingreso fijo como nómina -- define monto y frecuencia una sola vez. Un servicio marcado como esencial alerta a diario desde el primer día sin confirmar, sin importar la urgencia que elijas.',
      },
      {
        selector: '[data-tour="recurring:pending"]',
        title: 'Confirma antes de que cuente',
        text: 'Cuando se acerca la fecha, el sistema prepara el movimiento como borrador -- lo confirmas o lo rechazas antes de que sea una transacción real.',
      },
      {
        selector: '[data-tour="recurring:item-actions"]',
        title: 'Editar, pausar o cancelar',
        text: 'Editar conserva el historial. Pausar detiene la generación automática sin perder la configuración. Cancelar lo da de baja -- ninguna de las dos borra lo ya registrado.',
      },
      {
        selector: '[data-tour="recurring:status-filter"]',
        title: 'No desaparecen, se filtran',
        text: 'Un ítem pausado o cancelado no se borra de tu historial -- solo sale de "Activos". Cambia el filtro para volver a verlo.',
      },
      {
        selector: '[data-tour="recurring:card-commitments"]',
        title: 'Lo que ya deben tus tarjetas',
        text: 'Solo aparece si tienes tarjetas de crédito. Suma las mensualidades de tus compras a meses activas más lo gastado en el corte abierto -- es informativo, no se suma al "Comprometido / mes" de arriba (ese gasto ya se contó en el presupuesto del mes en que lo hiciste).',
      },
      {
        selector: '[data-tour="recurring:breakdown"]',
        title: 'Desglose por categoría',
        text: 'Cómo se reparte tu comprometido mensual entre categorías -- solo cuenta servicios/utilities activos, no ingresos.',
      },
      {
        selector: '[data-tour="recurring:upcoming"]',
        title: 'Próximos 7 días',
        text: 'Para planear tu quincena sabiendo qué se te viene encima.',
      },
    ],
  },
  subscriptions: {
    welcome: {
      description:
        'Tus suscripciones (streaming, software, membresías) por separado de otros recurrentes, para ver de un vistazo cuánto te cuestan al mes.',
      bullets: [
        'Registra una suscripción con su frecuencia de cobro',
        'El total convierte cada frecuencia a su equivalente mensual',
        'Un aviso pasivo te recuerda las que llevan más de 12 meses activas',
      ],
    },
    steps: [
      {
        selector: '[data-tour="subscriptions:new-button"]',
        title: 'Agrega una suscripción',
        text: 'Streaming, software o cualquier membresía -- monto, frecuencia y cuenta desde donde se cobra.',
      },
      {
        selector: '[data-tour="subscriptions:committed"]',
        title: 'Cuánto te cuesta al mes',
        text: 'Como no todas cobran mensual (algunas son anuales), el total convierte cada frecuencia a su equivalente mensual -- cada fila también muestra su propio equivalente.',
      },
      {
        selector: '[data-tour="subscriptions:item-actions"]',
        title: 'Editar, pausar o cancelar',
        text: 'Editar conserva el historial -- útil cuando te suben el precio, algo común en streaming y software. Pausar y Cancelar se pueden revertir mientras no vuelvas a suscribirte por fuera.',
      },
      {
        selector: '[data-tour="subscriptions:aging"]',
        title: '¿La sigues usando?',
        text: 'A partir de 12 meses activa, un aviso te pregunta si de verdad la sigues usando -- puramente informativo, no cambia nada solo.',
      },
      {
        selector: '[data-tour="subscriptions:status-filter"]',
        title: 'No desaparecen, se filtran',
        text: 'Una suscripción pausada o cancelada sigue en tu historial -- cambia el filtro para verla.',
      },
      {
        selector: '[data-tour="subscriptions:renewals"]',
        title: 'Próximas renovaciones',
        text: 'Lo que se renueva en los próximos 7 días, para que ningún cobro te agarre desprevenido.',
      },
    ],
  },
  advisor: {
    welcome: {
      description:
        'Un chat con IA que ve tu situación financiera real (cuentas, deudas, presupuesto, transacciones) y responde con eso como contexto -- no son respuestas genéricas.',
      bullets: [
        'Pregunta lo que quieras sobre tu situación financiera',
        'Puede crear transacciones, cuentas, deudas o recurrentes por ti -- siempre te pide confirmar antes de guardar nada',
        'No edita ni elimina nada que ya exista, solo crea',
        'Adjunta estados de cuenta en PDF para traer datos históricos',
        'Pídele que guarde un plan y lo verás después en Insights',
      ],
    },
    steps: [
      {
        selector: '[data-tour="advisor:suggestions"]',
        title: 'También puede crear datos por ti',
        text: 'No solo responde preguntas -- pídele que registre un gasto, una cuenta o una deuda y te va a proponer la acción con una tarjeta de Confirmar/Cancelar antes de guardarla.',
      },
      {
        selector: '[data-tour="advisor:attach"]',
        title: 'Trae tus estados de cuenta',
        text: 'Adjunta PDFs (aunque tengan contraseña) -- separa cargos normales de compras a meses y evita duplicados entre estados del mismo lote.',
      },
      {
        selector: '[data-tour="advisor:more"]',
        title: 'Más formas de traer datos',
        text: 'Importa desde Excel, o copia un prompt para pasarle tus datos desde otra IA (ChatGPT, Gemini) si ya los tienes ahí.',
      },
      {
        selector: '[data-tour="advisor:input"]',
        title: 'Pregunta lo que quieras',
        text: 'Los botones de preguntas comunes son solo un punto de partida -- escribe tu pregunta real aquí.',
      },
      {
        selector: '[data-tour="advisor:context"]',
        title: 'Lo que la IA ve de ti',
        text: 'Exactamente el contexto que usa para responder: patrimonio, salud financiera, comprometido del mes, disponible esta semana y tus últimas transacciones.',
      },
      {
        selector: '[data-tour="advisor:usage"]',
        title: 'Consultas restantes hoy',
        text: 'Hay un límite diario para controlar el costo de la IA -- se reinicia cada día.',
      },
    ],
  },
  insights: {
    welcome: {
      description:
        'Observaciones automáticas sobre tus finanzas basadas en tus datos reales: un patrón detectado, una alerta, una sugerencia.',
      bullets: [
        'Genera un análisis nuevo sobre tu situación actual',
        'También se crean solos cuando le pides al Asesor IA que guarde un plan',
        'Márcalos como resuelto o descártalos cuando ya no apliquen',
        'Cada insight activo se revisa solo con el tiempo',
      ],
    },
    steps: [
      {
        selector: '[data-tour="insights:generate"]',
        title: 'Genera un análisis nuevo',
        text: 'Corre el análisis sobre tu situación actual y crea insights si encuentra algo que valga la pena señalarte.',
      },
      {
        selector: '[data-tour="insights:card"]',
        title: 'Prioridad y categoría',
        text: 'La prioridad (alta/media/baja) es solo orientativa -- no dispara ninguna alerta extra por su cuenta. Si ya se revisó al menos una vez, "Ver revisiones" compara cómo cambió tu situación desde entonces.',
      },
      {
        selector: '[data-tour="insights:actions"]',
        title: 'Resuelto vs. Descartar',
        text: '"Resuelto" es para cuando ya atendiste lo que decía. "Descartar" es para cuando no te interesa. Ambos lo sacan de esta lista y lo mandan al historial de abajo.',
      },
      {
        selector: '[data-tour="insights:active"]',
        title: 'Máximo 10 activos',
        text: 'Cuando resuelves o descartas uno, sale de esta lista y pasa al historial de abajo.',
      },
      {
        selector: '[data-tour="insights:history"]',
        title: 'Todo lo que ya viste',
        text: 'Insights resueltos o descartados quedan aquí, con su categoría y fecha.',
      },
    ],
  },
  reports: {
    welcome: {
      description:
        'Reportes de periodos ya cerrados (mes o año anterior) -- una "foto" congelada de un periodo que ya terminó, con análisis generado sobre esos números.',
      bullets: [
        'Genera el reporte del mes o año anterior cuando quieras verlo',
        'Filtra entre ingresos, egresos o todos los movimientos',
        'Sigue tu patrimonio neto histórico a través de los meses',
      ],
    },
    steps: [
      {
        selector: '[data-tour="reports:generate-month"]',
        title: 'Genera un reporte',
        text: 'Los reportes no se crean solos -- los generas cuando quieras verlos.',
      },
      {
        selector: '[data-tour="reports:period-toggle"]',
        title: 'Mensual o anual',
        text: 'Un reporte anual necesita que ya existan los reportes mensuales de ese año.',
      },
      {
        selector: '[data-tour="reports:stats"]',
        title: 'Tasa de ahorro, DTI y salud',
        text: 'Los colores siguen umbrales fijos: tasa de ahorro y DTI (deuda vs. ingreso) cambian de verde a rojo según qué tan lejos estés de lo saludable. La salud financiera también marca si mejoró o empeoró vs. el periodo anterior.',
      },
      {
        selector: '[data-tour="reports:adjustments"]',
        title: 'Ajustes de saldo del periodo',
        text: 'Cuenta cuántas veces conciliaste un saldo en este periodo -- solo aparece si hubo al menos uno.',
      },
      {
        selector: '[data-tour="reports:flow-filter"]',
        title: 'Ingresos, egresos o todos',
        text: 'Este filtro mueve a la vez la categoría destacada y los "Puntos de este periodo" de abajo.',
      },
      {
        selector: '[data-tour="reports:categories"]',
        title: 'Categorías del periodo',
        text: 'Click en una categoría con subcategorías para desplegarlas -- no es obvio a simple vista, pero es clickeable.',
      },
      {
        selector: '[data-tour="reports:networth"]',
        title: 'Patrimonio neto histórico',
        text: 'Junta todos tus reportes mensuales generados en una sola línea de tendencia -- está colapsado por defecto, click para abrirlo.',
      },
      {
        selector: '[data-tour="reports:regenerate"]',
        title: 'Regenera si algo cambió',
        text: 'Recalcula desde cero el reporte que estás viendo con tus transacciones actuales -- útil si lo generaste antes de cargar historial viejo.',
      },
    ],
  },
  settings: {
    welcome: {
      description:
        'Tu perfil y las preferencias de tu cuenta -- no configuración de una pantalla en particular, sino de toda la app.',
      bullets: [
        'Actualiza tu foto de perfil y contraseña',
        'El tema se guarda en tu cuenta, no en este navegador',
        'Borra datos específicos sin perder tu cuenta',
      ],
    },
    steps: [
      {
        selector: '[data-tour="settings:profile"]',
        title: 'Tu perfil y contraseña',
        text: 'Nombre, foto y contraseña -- el mismo bloque incluye el formulario para cambiarla. Si entraste con Google, tu foto se importa la primera vez.',
      },
      {
        selector: '[data-tour="settings:preferences"]',
        title: 'Tema, notificaciones y ciclo de pago',
        text: 'El tema se guarda en tu cuenta -- si entras desde otro dispositivo, se ve igual. Email y push son canales independientes, puedes apagar solo uno. El ciclo de pago alimenta Dashboard y Presupuesto.',
      },
      {
        selector: '[data-tour="settings:debt-trouble"]',
        title: 'Deudas en problemas',
        text: 'Actívalo si tienes una deuda vencida que no estás pagando -- habilita una sección aparte en Deudas y le da ese contexto al Asesor IA.',
      },
      {
        selector: '[data-tour="settings:connected-accounts"]',
        title: 'Cuenta de Google',
        text: 'Puedes desvincular Google, pero solo si tu cuenta también tiene contraseña -- si no, te quedarías sin forma de entrar.',
      },
      {
        selector: '[data-tour="settings:data"]',
        title: 'Empieza de cero sin perder tu cuenta',
        text: 'Borra todo excepto cuentas, absolutamente todo, o solo categorías específicas como transacciones o el historial del Asesor IA.',
      },
      {
        selector: '[data-tour="settings:delete-account"]',
        title: 'Eliminar cuenta',
        text: 'Distinto de "Borrar datos": esto cierra tus sesiones y desactiva el acceso por completo. No se puede deshacer.',
      },
    ],
  },
  notifications: {
    welcome: {
      description:
        'Todos los avisos que te ha generado la app: reportes listos, insights nuevos, alertas de presupuesto o deuda, y recordatorios de pagos pendientes.',
      bullets: [
        'Un punto de color marca lo que no has leído',
        'Marca todo como leído de una sola vez',
        'El ícono y color de cada una indican su tipo sin tener que abrirla',
        'Los canales de email y push se activan o desactivan desde Ajustes, no aquí',
      ],
    },
    steps: [
      {
        selector: '[data-tour="notifications:mark-all"]',
        title: 'Marca todo de una vez',
        text: 'En vez de abrir una por una, esto las marca todas como leídas al momento.',
      },
      {
        selector: '[data-tour="notifications:list"]',
        title: 'Tu lista de avisos',
        text: 'Click en cualquiera para marcarla como leída -- el texto completo ya está en la fila, no hay una vista de detalle aparte. El ícono y el color a la izquierda te dicen el tipo sin necesidad de leer.',
      },
      {
        selector: '[data-tour="notifications:total-badge"]',
        title: 'Total acumulado',
        text: 'Cuenta todas tus notificaciones históricas -- la lista de arriba solo muestra las 50 más recientes.',
      },
    ],
  },
  categories: {
    welcome: {
      description:
        'Aquí organizas en qué se va (y de dónde viene) tu dinero. Cada transacción pertenece a una categoría, y las de gasto pueden tener subcategorías propias.',
      bullets: [
        'Crea categorías con color e ícono propio',
        'Agrupa gastos parecidos en subcategorías (un solo nivel)',
        'Compara cuánto gastas por categoría cada mes',
      ],
    },
    steps: [
      {
        selector: '[data-tour="categories:type-toggle"]',
        title: 'Ingresos o gastos',
        text: 'Cambia el catálogo completo que ves -- solo las categorías de gasto de primer nivel pueden tener subcategorías.',
      },
      {
        selector: '[data-tour="categories:new-button"]',
        title: 'Crea categorías nuevas',
        text: 'Dale nombre, color e ícono a cualquier categoría que todavía no tengas -- hay más de 150 íconos para elegir, agrupados por tema.',
      },
      {
        selector: '[data-tour="categories:first-card"]',
        title: 'Así se ve cada categoría',
        text: 'El monto de arriba es lo gastado (o recibido) este mes. Si tiene subcategorías, puedes desplegarlas para ver el detalle -- el presupuesto siempre se define en la categoría padre, nunca en la subcategoría.',
      },
      {
        selector: '[data-tour="categories:actions"]',
        title: 'Sistema vs. propias',
        text: 'Las categorías del sistema no se pueden eliminar, solo desactivar para ti (dejan de aparecerte, sin afectar a nadie más). Las que tú creaste sí se pueden editar o eliminar del todo.',
      },
      {
        selector: '[data-tour="categories:segbar"]',
        title: 'Desglose por subcategoría',
        text: 'Cada color de la barra es una subcategoría distinta, comparada contra el gasto directo de la categoría. Pasa el mouse para ver el monto exacto.',
      },
      {
        selector: '[data-tour="categories:hidden-section"]',
        title: 'Categorías desactivadas',
        text: 'Las que desactivaste para ti quedan aquí abajo, no desaparecen del todo -- reactívalas cuando quieras.',
      },
      {
        selector: '[data-tour="categories:help-button"]',
        title: '¿Dudas después?',
        text: 'Vuelve a este ícono cuando quieras repasar todo esto de nuevo, sin tener que buscarlo.',
      },
    ],
  },
}
