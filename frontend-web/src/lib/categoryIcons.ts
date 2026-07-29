import {
  Baby,
  Banknote,
  Briefcase,
  Car,
  Coffee,
  CreditCard,
  Cpu,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Landmark,
  Laptop,
  Music,
  MoreHorizontal,
  PawPrint,
  PiggyBank,
  Plane,
  PlusCircle,
  Shirt,
  ShoppingBag,
  Smartphone,
  Tag,
  TrendingUp,
  User,
  Utensils,
  Wine,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/** Llave = mismo formato kebab-case que categories.icon en la BD (ver
 * seed/migraciones de categorias del sistema, ej. "paw-print", "gamepad-2")
 * -- asi que las categorias del sistema ya renderizan bien sin tocar datos.
 * El picker de creacion/edicion solo ofrece este subconjunto (no cualquier
 * icono de lucide) para que la eleccion sea rapida y el valor guardado
 * siempre resuelva a un icono real. */
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
}

/** Subconjunto curado para el picker de creacion/edicion -- suficiente
 * variedad sin abrumar, y todos resuelven via CATEGORY_ICON_MAP. */
export const CATEGORY_ICON_CHOICES: string[] = [
  'utensils',
  'wine',
  'shopping-bag',
  'car',
  'fuel',
  'home',
  'wrench',
  'cpu',
  'smartphone',
  'laptop',
  'heart',
  'dumbbell',
  'paw-print',
  'shirt',
  'gamepad-2',
  'music',
  'film',
  'plane',
  'graduation-cap',
  'baby',
  'gift',
  'user',
  'credit-card',
  'briefcase',
  'trending-up',
  'piggy-bank',
  'landmark',
  'banknote',
  'more-horizontal',
]

export function categoryIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return Tag
  return CATEGORY_ICON_MAP[iconName] ?? Tag
}

/** Misma paleta de 7 colores que ya usan las categorias del sistema (ver
 * migracion 4bb6c6945c68_distinct_system_category_colors) -- un picker de
 * hex libre podria chocar con el tema o quedar igual a otra categoria;
 * restringir a esta paleta garantiza que una categoria propia se vea tan
 * intencional como las del sistema. */
export const CATEGORY_COLOR_CHOICES = [
  '#00c9a7', // --nl-accent
  '#4e8ef0', // --nl-blue
  '#f5a623', // --nl-warning
  '#8b7cf6', // --nl-violet
  '#f04e4e', // --nl-danger
  '#e85d9c', // --nl-pink
  '#6f6f76', // --nl-text-secondary (neutro)
]
