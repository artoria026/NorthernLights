import {
  Activity,
  Anchor,
  Apple,
  Armchair,
  Award,
  Baby,
  Backpack,
  Banana,
  Bandage,
  Banknote,
  BarChart3,
  Bed,
  Beer,
  Bell,
  Bike,
  Bird,
  BookOpen,
  Boxes,
  Brain,
  Briefcase,
  Building,
  Building2,
  Bug,
  Bus,
  Cake,
  Calculator,
  Calendar,
  Camera,
  Candy,
  Car,
  CarFront,
  Carrot,
  Cat,
  Cherry,
  Church,
  Clapperboard,
  Cloud,
  Coffee,
  Coins,
  Compass,
  Cpu,
  CreditCard,
  Croissant,
  Crown,
  CupSoda,
  Diamond,
  Dice5,
  DollarSign,
  DoorOpen,
  Drama,
  Droplet,
  Drumstick,
  Dumbbell,
  Ear,
  Egg,
  Eye,
  Fan,
  Feather,
  FileText,
  Film,
  Flag,
  Flame,
  Folder,
  Footprints,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  GraduationCap,
  Guitar,
  Hammer,
  HandCoins,
  Handshake,
  Headphones,
  Heart,
  HeartPulse,
  Home,
  IceCreamCone,
  Joystick,
  Key,
  Lamp,
  Landmark,
  Laptop,
  Lightbulb,
  LineChart,
  Mic,
  Milk,
  Moon,
  Mountain,
  Music,
  MoreHorizontal,
  Navigation,
  Package,
  PaintRoller,
  Palette,
  ParkingCircle,
  PartyPopper,
  PawPrint,
  Percent,
  Pill,
  PiggyBank,
  Pizza,
  Plane,
  Plug,
  PlusCircle,
  Podcast,
  Presentation,
  Puzzle,
  Rabbit,
  Radio,
  Rainbow,
  Receipt,
  Refrigerator,
  Rocket,
  Route,
  Salad,
  Sandwich,
  Scissors,
  Shirt,
  ShieldPlus,
  ShoppingBag,
  ShoppingCart,
  Ship,
  Smartphone,
  Snowflake,
  Sofa,
  Soup,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Sun,
  Syringe,
  Tag,
  Target,
  Thermometer,
  Ticket,
  TrafficCone,
  Train,
  TreePine,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
  Umbrella,
  User,
  Users,
  Utensils,
  Wallet,
  WashingMachine,
  Watch,
  Waves,
  Wine,
  Wrench,
  MapPin,
  type LucideIcon,
} from 'lucide-react'

/** Llave = mismo formato kebab-case que categories.icon en la BD (ver
 * seed/migraciones de categorias del sistema, ej. "paw-print", "gamepad-2")
 * -- asi que las categorias del sistema ya renderizan bien sin tocar datos.
 * NUNCA renombrar/quitar una llave existente: rompe el icono de cualquier
 * categoria (del sistema o de un usuario) ya guardada con ese valor. Los
 * nuevos se agregan libremente. */
const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  utensils: Utensils,
  wine: Wine,
  car: Car,
  home: Home,
  cpu: Cpu,
  heart: Heart,
  'paw-print': PawPrint,
  user: User,
  'gamepad-2': Gamepad2,
  wrench: Wrench,
  shirt: Shirt,
  'credit-card': CreditCard,
  'more-horizontal': MoreHorizontal,
  briefcase: Briefcase,
  laptop: Laptop,
  'plus-circle': PlusCircle,
  'shopping-bag': ShoppingBag,
  fuel: Fuel,
  plane: Plane,
  'graduation-cap': GraduationCap,
  gift: Gift,
  'piggy-bank': PiggyBank,
  smartphone: Smartphone,
  dumbbell: Dumbbell,
  coffee: Coffee,
  music: Music,
  film: Film,
  baby: Baby,
  'trending-up': TrendingUp,
  landmark: Landmark,
  banknote: Banknote,
  // -- primera ampliacion (antes 29) --
  pizza: Pizza,
  apple: Apple,
  cake: Cake,
  'shopping-cart': ShoppingCart,
  croissant: Croissant,
  beer: Beer,
  bus: Bus,
  train: Train,
  bike: Bike,
  'parking-circle': ParkingCircle,
  lightbulb: Lightbulb,
  sofa: Sofa,
  key: Key,
  droplet: Droplet,
  bed: Bed,
  'building-2': Building2,
  pill: Pill,
  stethoscope: Stethoscope,
  activity: Activity,
  glasses: Glasses,
  watch: Watch,
  footprints: Footprints,
  headphones: Headphones,
  camera: Camera,
  'book-open': BookOpen,
  palette: Palette,
  ticket: Ticket,
  clapperboard: Clapperboard,
  wallet: Wallet,
  receipt: Receipt,
  'hand-coins': HandCoins,
  star: Star,
  sun: Sun,
  umbrella: Umbrella,
  'tree-pine': TreePine,
  cat: Cat,
  // -- segunda ampliacion: agrupado por tema (ver CATEGORY_ICON_META) --
  'ice-cream': IceCreamCone,
  soup: Soup,
  sandwich: Sandwich,
  cherry: Cherry,
  banana: Banana,
  carrot: Carrot,
  milk: Milk,
  'cup-soda': CupSoda,
  egg: Egg,
  salad: Salad,
  drumstick: Drumstick,
  candy: Candy,
  truck: Truck,
  ship: Ship,
  anchor: Anchor,
  compass: Compass,
  navigation: Navigation,
  'traffic-cone': TrafficCone,
  'car-front': CarFront,
  route: Route,
  rocket: Rocket,
  'map-pin': MapPin,
  hammer: Hammer,
  plug: Plug,
  fan: Fan,
  thermometer: Thermometer,
  'door-open': DoorOpen,
  'washing-machine': WashingMachine,
  refrigerator: Refrigerator,
  lamp: Lamp,
  armchair: Armchair,
  boxes: Boxes,
  package: Package,
  'paint-roller': PaintRoller,
  syringe: Syringe,
  brain: Brain,
  eye: Eye,
  ear: Ear,
  'heart-pulse': HeartPulse,
  'shield-plus': ShieldPlus,
  waves: Waves,
  bandage: Bandage,
  crown: Crown,
  gem: Gem,
  scissors: Scissors,
  diamond: Diamond,
  backpack: Backpack,
  sparkles: Sparkles,
  tv: Tv,
  radio: Radio,
  guitar: Guitar,
  drama: Drama,
  trophy: Trophy,
  dice: Dice5,
  'party-popper': PartyPopper,
  mic: Mic,
  podcast: Podcast,
  puzzle: Puzzle,
  joystick: Joystick,
  calculator: Calculator,
  'file-text': FileText,
  folder: Folder,
  building: Building,
  store: Store,
  'line-chart': LineChart,
  'bar-chart': BarChart3,
  coins: Coins,
  'dollar-sign': DollarSign,
  percent: Percent,
  handshake: Handshake,
  target: Target,
  presentation: Presentation,
  flame: Flame,
  snowflake: Snowflake,
  moon: Moon,
  cloud: Cloud,
  rainbow: Rainbow,
  mountain: Mountain,
  feather: Feather,
  bug: Bug,
  bird: Bird,
  rabbit: Rabbit,
  users: Users,
  award: Award,
  flag: Flag,
  bell: Bell,
  calendar: Calendar,
  church: Church,
}

export const CATEGORY_ICON_GROUPS = [
  'Comida y Bebidas',
  'Transporte',
  'Hogar',
  'Salud',
  'Estilo y Cuidado',
  'Ocio y Entretenimiento',
  'Trabajo y Dinero',
  'Otros',
] as const
export type CategoryIconGroup = (typeof CATEGORY_ICON_GROUPS)[number]

/** Nombre en espanol para el tooltip del picker, grupo tematico (para el
 * riel del picker) y sinonimos extra para el buscador -- "gasolina" debe
 * encontrar `fuel`, no solo quien ya sepa que se llama "fuel" en el
 * sistema. */
export const CATEGORY_ICON_META: Record<string, { label: string; group: CategoryIconGroup; keywords?: string[] }> = {
  utensils: { label: 'Comida', group: 'Comida y Bebidas', keywords: ['restaurante', 'comer'] },
  wine: { label: 'Vino', group: 'Comida y Bebidas', keywords: ['bebida', 'alcohol', 'copa'] },
  beer: { label: 'Cerveza', group: 'Comida y Bebidas', keywords: ['bebida', 'alcohol'] },
  coffee: { label: 'Café', group: 'Comida y Bebidas', keywords: ['bebida'] },
  pizza: { label: 'Pizza', group: 'Comida y Bebidas' },
  apple: { label: 'Fruta', group: 'Comida y Bebidas', keywords: ['manzana', 'sano'] },
  cake: { label: 'Postre', group: 'Comida y Bebidas', keywords: ['pastel', 'dulce'] },
  croissant: { label: 'Panadería', group: 'Comida y Bebidas', keywords: ['pan'] },
  'shopping-cart': { label: 'Súper', group: 'Comida y Bebidas', keywords: ['supermercado', 'despensa'] },
  'ice-cream': { label: 'Helado', group: 'Comida y Bebidas', keywords: ['nieve', 'paleta'] },
  soup: { label: 'Sopa', group: 'Comida y Bebidas', keywords: ['caldo'] },
  sandwich: { label: 'Sándwich', group: 'Comida y Bebidas', keywords: ['torta'] },
  cherry: { label: 'Fruta', group: 'Comida y Bebidas', keywords: ['cereza'] },
  banana: { label: 'Fruta', group: 'Comida y Bebidas', keywords: ['plátano'] },
  carrot: { label: 'Verdura', group: 'Comida y Bebidas', keywords: ['zanahoria'] },
  milk: { label: 'Leche', group: 'Comida y Bebidas', keywords: ['lácteos'] },
  'cup-soda': { label: 'Refresco', group: 'Comida y Bebidas', keywords: ['soda'] },
  egg: { label: 'Huevo', group: 'Comida y Bebidas' },
  salad: { label: 'Ensalada', group: 'Comida y Bebidas', keywords: ['sano'] },
  drumstick: { label: 'Carne', group: 'Comida y Bebidas', keywords: ['pollo'] },
  candy: { label: 'Dulces', group: 'Comida y Bebidas', keywords: ['golosinas'] },

  car: { label: 'Auto', group: 'Transporte', keywords: ['carro', 'coche'] },
  fuel: { label: 'Gasolina', group: 'Transporte', keywords: ['combustible', 'gas'] },
  bus: { label: 'Camión', group: 'Transporte', keywords: ['transporte público', 'autobús'] },
  train: { label: 'Tren', group: 'Transporte', keywords: ['metro'] },
  bike: { label: 'Bici', group: 'Transporte', keywords: ['bicicleta'] },
  plane: { label: 'Avión', group: 'Transporte', keywords: ['vuelo', 'viaje'] },
  'parking-circle': { label: 'Estacionamiento', group: 'Transporte', keywords: ['parquímetro'] },
  truck: { label: 'Camión de carga', group: 'Transporte', keywords: ['mudanza'] },
  ship: { label: 'Barco', group: 'Transporte', keywords: ['crucero'] },
  anchor: { label: 'Náutico', group: 'Transporte', keywords: ['ancla', 'barco'] },
  compass: { label: 'Brújula', group: 'Transporte', keywords: ['viaje'] },
  navigation: { label: 'Navegación', group: 'Transporte', keywords: ['gps', 'mapa'] },
  'traffic-cone': { label: 'Tránsito', group: 'Transporte', keywords: ['obra', 'vialidad'] },
  'car-front': { label: 'Vehículo', group: 'Transporte' },
  route: { label: 'Ruta', group: 'Transporte', keywords: ['camino'] },
  rocket: { label: 'Viaje', group: 'Transporte', keywords: ['cohete', 'lanzamiento'] },
  'map-pin': { label: 'Ubicación', group: 'Transporte', keywords: ['destino'] },

  home: { label: 'Casa', group: 'Hogar', keywords: ['hogar', 'renta'] },
  wrench: { label: 'Mantenimiento', group: 'Hogar', keywords: ['reparación', 'herramienta'] },
  lightbulb: { label: 'Luz', group: 'Hogar', keywords: ['electricidad', 'cfe'] },
  droplet: { label: 'Agua', group: 'Hogar' },
  sofa: { label: 'Muebles', group: 'Hogar' },
  bed: { label: 'Recámara', group: 'Hogar' },
  key: { label: 'Llave', group: 'Hogar', keywords: ['renta', 'depósito'] },
  'building-2': { label: 'Edificio', group: 'Hogar', keywords: ['condominio', 'mantenimiento'] },
  hammer: { label: 'Construcción', group: 'Hogar', keywords: ['reparación'] },
  plug: { label: 'Enchufe', group: 'Hogar', keywords: ['electricidad'] },
  fan: { label: 'Ventilador', group: 'Hogar', keywords: ['clima'] },
  thermometer: { label: 'Temperatura', group: 'Hogar', keywords: ['clima', 'clima artificial'] },
  'door-open': { label: 'Puerta', group: 'Hogar', keywords: ['acceso'] },
  'washing-machine': { label: 'Lavadora', group: 'Hogar', keywords: ['lavandería'] },
  refrigerator: { label: 'Refrigerador', group: 'Hogar', keywords: ['electrodoméstico'] },
  lamp: { label: 'Lámpara', group: 'Hogar', keywords: ['iluminación'] },
  armchair: { label: 'Sillón', group: 'Hogar', keywords: ['muebles'] },
  boxes: { label: 'Mudanza', group: 'Hogar', keywords: ['cajas'] },
  package: { label: 'Paquete', group: 'Hogar', keywords: ['envío', 'entrega'] },
  'paint-roller': { label: 'Pintura', group: 'Hogar', keywords: ['remodelación'] },

  heart: { label: 'Salud', group: 'Salud', keywords: ['corazón'] },
  pill: { label: 'Medicina', group: 'Salud', keywords: ['farmacia'] },
  stethoscope: { label: 'Doctor', group: 'Salud', keywords: ['consulta', 'médico'] },
  activity: { label: 'Actividad física', group: 'Salud', keywords: ['ejercicio'] },
  dumbbell: { label: 'Gimnasio', group: 'Salud', keywords: ['ejercicio', 'pesas'] },
  glasses: { label: 'Lentes', group: 'Salud', keywords: ['óptica'] },
  syringe: { label: 'Vacuna', group: 'Salud', keywords: ['inyección'] },
  brain: { label: 'Mente', group: 'Salud', keywords: ['psicología', 'terapia'] },
  eye: { label: 'Vista', group: 'Salud', keywords: ['oftalmología'] },
  ear: { label: 'Oído', group: 'Salud', keywords: ['audición'] },
  'heart-pulse': { label: 'Cardiología', group: 'Salud' },
  'shield-plus': { label: 'Seguro médico', group: 'Salud' },
  waves: { label: 'Spa', group: 'Salud', keywords: ['relajación', 'masaje'] },
  bandage: { label: 'Curación', group: 'Salud', keywords: ['herida'] },

  shirt: { label: 'Ropa', group: 'Estilo y Cuidado' },
  watch: { label: 'Reloj', group: 'Estilo y Cuidado', keywords: ['accesorio'] },
  footprints: { label: 'Calzado', group: 'Estilo y Cuidado', keywords: ['zapatos'] },
  'shopping-bag': { label: 'Compras', group: 'Estilo y Cuidado' },
  crown: { label: 'Lujo', group: 'Estilo y Cuidado' },
  gem: { label: 'Joyería', group: 'Estilo y Cuidado' },
  scissors: { label: 'Corte de pelo', group: 'Estilo y Cuidado', keywords: ['estética', 'salón'] },
  diamond: { label: 'Joyería', group: 'Estilo y Cuidado', keywords: ['accesorio'] },
  backpack: { label: 'Mochila', group: 'Estilo y Cuidado' },
  sparkles: { label: 'Belleza', group: 'Estilo y Cuidado', keywords: ['brillo', 'cuidado personal'] },

  'gamepad-2': { label: 'Videojuegos', group: 'Ocio y Entretenimiento' },
  music: { label: 'Música', group: 'Ocio y Entretenimiento' },
  headphones: { label: 'Audio', group: 'Ocio y Entretenimiento', keywords: ['música'] },
  film: { label: 'Cine', group: 'Ocio y Entretenimiento', keywords: ['película'] },
  clapperboard: { label: 'Streaming', group: 'Ocio y Entretenimiento', keywords: ['película', 'serie'] },
  camera: { label: 'Fotografía', group: 'Ocio y Entretenimiento' },
  'book-open': { label: 'Libros', group: 'Ocio y Entretenimiento', keywords: ['lectura'] },
  palette: { label: 'Arte', group: 'Ocio y Entretenimiento', keywords: ['creatividad'] },
  ticket: { label: 'Boleto', group: 'Ocio y Entretenimiento', keywords: ['evento', 'concierto'] },
  tv: { label: 'Televisión', group: 'Ocio y Entretenimiento' },
  radio: { label: 'Radio', group: 'Ocio y Entretenimiento' },
  guitar: { label: 'Instrumento musical', group: 'Ocio y Entretenimiento' },
  drama: { label: 'Teatro', group: 'Ocio y Entretenimiento' },
  trophy: { label: 'Trofeo', group: 'Ocio y Entretenimiento', keywords: ['logro', 'deporte'] },
  dice: { label: 'Juegos de mesa', group: 'Ocio y Entretenimiento' },
  'party-popper': { label: 'Fiesta', group: 'Ocio y Entretenimiento', keywords: ['celebración'] },
  mic: { label: 'Karaoke', group: 'Ocio y Entretenimiento', keywords: ['micrófono'] },
  podcast: { label: 'Podcast', group: 'Ocio y Entretenimiento' },
  puzzle: { label: 'Rompecabezas', group: 'Ocio y Entretenimiento', keywords: ['pasatiempo'] },
  joystick: { label: 'Control de videojuegos', group: 'Ocio y Entretenimiento' },

  cpu: { label: 'Tecnología', group: 'Trabajo y Dinero', keywords: ['electrónica'] },
  laptop: { label: 'Computadora', group: 'Trabajo y Dinero' },
  smartphone: { label: 'Celular', group: 'Trabajo y Dinero', keywords: ['teléfono'] },
  briefcase: { label: 'Trabajo', group: 'Trabajo y Dinero', keywords: ['oficina'] },
  'trending-up': { label: 'Inversión', group: 'Trabajo y Dinero', keywords: ['ahorro'] },
  'piggy-bank': { label: 'Ahorro', group: 'Trabajo y Dinero', keywords: ['alcancía'] },
  landmark: { label: 'Banco', group: 'Trabajo y Dinero' },
  banknote: { label: 'Efectivo', group: 'Trabajo y Dinero', keywords: ['dinero'] },
  'credit-card': { label: 'Tarjeta', group: 'Trabajo y Dinero' },
  wallet: { label: 'Cartera', group: 'Trabajo y Dinero', keywords: ['dinero'] },
  receipt: { label: 'Recibo', group: 'Trabajo y Dinero', keywords: ['factura'] },
  'hand-coins': { label: 'Pago', group: 'Trabajo y Dinero', keywords: ['propina'] },
  calculator: { label: 'Contabilidad', group: 'Trabajo y Dinero' },
  'file-text': { label: 'Documentos', group: 'Trabajo y Dinero', keywords: ['papeleo'] },
  folder: { label: 'Archivo', group: 'Trabajo y Dinero' },
  building: { label: 'Oficina', group: 'Trabajo y Dinero', keywords: ['empresa'] },
  store: { label: 'Negocio', group: 'Trabajo y Dinero', keywords: ['tienda'] },
  'line-chart': { label: 'Gráfica', group: 'Trabajo y Dinero', keywords: ['inversión'] },
  'bar-chart': { label: 'Estadísticas', group: 'Trabajo y Dinero' },
  coins: { label: 'Monedas', group: 'Trabajo y Dinero' },
  'dollar-sign': { label: 'Dólares', group: 'Trabajo y Dinero', keywords: ['divisa'] },
  percent: { label: 'Interés', group: 'Trabajo y Dinero', keywords: ['comisión', 'tasa'] },
  handshake: { label: 'Acuerdo', group: 'Trabajo y Dinero', keywords: ['trato', 'sociedad'] },
  target: { label: 'Meta financiera', group: 'Trabajo y Dinero', keywords: ['objetivo'] },
  presentation: { label: 'Presentación', group: 'Trabajo y Dinero', keywords: ['junta'] },

  'graduation-cap': { label: 'Educación', group: 'Otros', keywords: ['escuela', 'universidad'] },
  gift: { label: 'Regalo', group: 'Otros' },
  'paw-print': { label: 'Mascota', group: 'Otros', keywords: ['perro', 'gato'] },
  cat: { label: 'Gato', group: 'Otros' },
  baby: { label: 'Bebé', group: 'Otros', keywords: ['hijo', 'hija'] },
  star: { label: 'Favorito', group: 'Otros' },
  sun: { label: 'Vacaciones', group: 'Otros', keywords: ['sol', 'playa'] },
  umbrella: { label: 'Seguro', group: 'Otros', keywords: ['protección'] },
  'tree-pine': { label: 'Naturaleza', group: 'Otros', keywords: ['exterior'] },
  user: { label: 'Personal', group: 'Otros' },
  'plus-circle': { label: 'Otro', group: 'Otros' },
  'more-horizontal': { label: 'Más', group: 'Otros' },
  flame: { label: 'Fuego', group: 'Otros' },
  snowflake: { label: 'Invierno', group: 'Otros', keywords: ['frío'] },
  moon: { label: 'Noche', group: 'Otros' },
  cloud: { label: 'Clima', group: 'Otros' },
  rainbow: { label: 'Arcoíris', group: 'Otros' },
  mountain: { label: 'Naturaleza', group: 'Otros', keywords: ['montaña', 'exterior'] },
  feather: { label: 'Pluma', group: 'Otros', keywords: ['ligero'] },
  bug: { label: 'Insecto', group: 'Otros' },
  bird: { label: 'Ave', group: 'Otros', keywords: ['pájaro'] },
  rabbit: { label: 'Conejo', group: 'Otros', keywords: ['mascota'] },
  users: { label: 'Familia', group: 'Otros', keywords: ['grupo', 'compartido'] },
  award: { label: 'Premio', group: 'Otros', keywords: ['logro'] },
  flag: { label: 'Meta', group: 'Otros', keywords: ['bandera', 'objetivo'] },
  bell: { label: 'Recordatorio', group: 'Otros', keywords: ['notificación'] },
  calendar: { label: 'Calendario', group: 'Otros', keywords: ['fecha'] },
  church: { label: 'Religión', group: 'Otros', keywords: ['iglesia'] },
}

/** Subconjunto curado para el picker de creacion/edicion -- todos resuelven
 * via CATEGORY_ICON_MAP y tienen entrada en CATEGORY_ICON_META. */
export const CATEGORY_ICON_CHOICES: string[] = Object.keys(CATEGORY_ICON_MAP)

export function categoryIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return Tag
  return CATEGORY_ICON_MAP[iconName] ?? Tag
}

export function categoryIconLabel(iconName: string): string {
  return CATEGORY_ICON_META[iconName]?.label ?? iconName
}

/** Los iconos de un grupo tematico, en el mismo orden que CATEGORY_ICON_CHOICES. */
export function iconsInGroup(group: CategoryIconGroup): string[] {
  return CATEGORY_ICON_CHOICES.filter((name) => CATEGORY_ICON_META[name]?.group === group)
}

/** Texto contra el que buscar: la llave, el nombre en espanol, y sinonimos.
 * Todo en minusculas, sin acentos, para que "cafe" encuentre "café". */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function matchesIconSearch(iconName: string, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  const meta = CATEGORY_ICON_META[iconName]
  const haystack = [iconName, meta?.label, ...(meta?.keywords ?? [])].filter(Boolean).join(' ')
  return normalize(haystack).includes(q)
}

const RECENT_ICONS_KEY = 'nl:recent-category-icons'
const MAX_RECENT_ICONS = 8

/** Ultimos iconos elegidos por este usuario en este navegador -- localStorage
 * a proposito (no vale la pena una tabla/endpoint de backend para una
 * preferencia puramente de UX del picker). Se lee/escribe solo desde
 * IconGridPicker. */
export function getRecentCategoryIcons(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ICONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v in CATEGORY_ICON_MAP)
  } catch {
    return []
  }
}

export function recordRecentCategoryIcon(iconName: string): void {
  try {
    const current = getRecentCategoryIcons().filter((i) => i !== iconName)
    const next = [iconName, ...current].slice(0, MAX_RECENT_ICONS)
    localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(next))
  } catch {
    // localStorage no disponible (modo privado, etc.) -- no es critico, se ignora
  }
}

/** Los primeros 7 son la paleta original, la misma que ya usan las
 * categorias del sistema (ver migracion 4bb6c6945c68_distinct_system_category_colors)
 * -- se mantienen intactos y en el mismo orden para no correr el default
 * (CATEGORY_COLOR_CHOICES[0]) ni el color de ninguna categoria ya guardada.
 * Los siguientes son una ampliacion (mismo criterio: suficiente contraste
 * para el icono blanco encima, ver CategoryCard). El picker (ColorSwatchPicker
 * en Categorias.tsx) ademas deja elegir CUALQUIER hex con un <input
 * type="color"> nativo -- esta lista ya no es el techo, es el atajo rapido. */
export const CATEGORY_COLOR_CHOICES = [
  '#00c9a7', // --nl-accent (teal)
  '#4e8ef0', // --nl-blue
  '#f5a623', // --nl-warning (naranja)
  '#8b7cf6', // --nl-violet
  '#f04e4e', // --nl-danger (rojo)
  '#e85d9c', // --nl-pink
  '#6f6f76', // --nl-text-secondary (gris neutro)
  '#16a34a', // verde
  '#ca8a04', // mostaza
  '#0891b2', // cian
  '#6366f1', // indigo
  '#92400e', // café
  '#334155', // azul marino
  '#c026d3', // fucsia
]
