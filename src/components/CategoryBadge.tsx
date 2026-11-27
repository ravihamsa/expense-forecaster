import type { CSSProperties } from 'react'
import {
  Briefcase,
  Building2,
  Car,
  Clapperboard,
  Coffee,
  Coins,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  MoreHorizontal,
  Palette,
  PawPrint,
  Percent,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { categorySlug } from '../lib/categories'

const ICONS: Record<string, LucideIcon> = {
  housing: House,
  home: House,
  utilities: Zap,
  groceries: ShoppingBasket,
  grocery: ShoppingBasket,
  transport: Car,
  fuel: Fuel,
  insurance: ShieldCheck,
  health: HeartPulse,
  education: GraduationCap,
  shopping: ShoppingBag,
  dining: Utensils,
  entertainment: Clapperboard,
  subscriptions: Repeat,
  travel: Plane,
  lifestyle: Sparkles,
  hobbies: Palette,
  investments: TrendingUp,
  salary: Wallet,
  business: Briefcase,
  freelance: Laptop,
  'rent-received': Building2,
  interest: Percent,
  dividends: Coins,
  gifts: Gift,
  pet: PawPrint,
  pets: PawPrint,
  phone: Smartphone,
  internet: Wifi,
  coffee: Coffee,
  bills: Receipt,
  loan: Landmark,
  savings: PiggyBank,
  other: MoreHorizontal,
}

const KEYWORD_ICONS: [RegExp, LucideIcon][] = [
  [/grocer|food|vegetable|fruit/, ShoppingBasket],
  [/fuel|petrol|diesel|gas/, Fuel],
  [/house|rent|home|housing/, House],
  [/electric|water|utility|bill/, Zap],
  [/car|taxi|metro|bus|transport/, Car],
  [/health|medical|doctor|medicine/, HeartPulse],
  [/school|college|education|course/, GraduationCap],
  [/shop|clothes|apparel/, ShoppingBag],
  [/dining|restaurant|food|breakfast/, Utensils],
  [/movie|film|entertain/, Clapperboard],
  [/subscription|membership/, Repeat],
  [/travel|trip|flight/, Plane],
  [/pet|dog|cat/, PawPrint],
  [/phone|mobile/, Smartphone],
  [/internet|wifi|broadband/, Wifi],
  [/invest|stock|mutual/, TrendingUp],
  [/salary|income|payroll/, Wallet],
  [/business|company/, Briefcase],
  [/saving|fund/, PiggyBank],
]

const COLORS = [
  '#2dd4a7', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa',
  '#34d399', '#fb923c', '#22d3ee', '#f87171', '#c084fc',
]

export function categoryColor(name: string): string {
  const slug = categorySlug(name)
  let hash = 0
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

export function categoryIcon(name: string): LucideIcon {
  const slug = categorySlug(name)
  if (ICONS[slug]) return ICONS[slug]
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(slug)) return icon
  }
  return MoreHorizontal
}

interface Props {
  name: string
  size?: number
  small?: boolean
  className?: string
}

export default function CategoryBadge({ name, size = 15, small = false, className = '' }: Props) {
  const Icon = categoryIcon(name)
  const style = { '--cat-color': categoryColor(name) } as CSSProperties
  return (
    <span
      className={`category-badge ${small ? 'category-badge-small' : ''} ${className}`.trim()}
      style={style}
      title={name}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={2} />
    </span>
  )
}
