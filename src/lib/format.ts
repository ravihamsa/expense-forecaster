const symbols: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export function currencySymbol(currency: string): string {
  return symbols[currency] ?? currency
}

export function formatMoney(amount: number, currency = 'INR', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatCompact(amount: number, currency = 'INR'): string {
  const sign = amount < 0 ? '-' : ''
  const value = Math.abs(amount)
  const symbol = currencySymbol(currency)
  if (currency === 'INR') {
    if (value >= 1e7) return `${sign}${symbol}${(value / 1e7).toFixed(2)} Cr`
    if (value >= 1e5) return `${sign}${symbol}${(value / 1e5).toFixed(2)} L`
    if (value >= 1e3) return `${sign}${symbol}${(value / 1e3).toFixed(1)} K`
    return `${sign}${symbol}${Math.round(value).toLocaleString('en-IN')}`
  }
  if (value >= 1e9) return `${sign}${symbol}${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${sign}${symbol}${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${sign}${symbol}${(value / 1e3).toFixed(1)}K`
  return `${sign}${symbol}${Math.round(value).toLocaleString('en-US')}`
}

export function formatSigned(amount: number, currency = 'INR'): string {
  return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${formatMoney(Math.abs(amount), currency)}`
}

export function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`
}

export function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function monthYearLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function shortMonthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-IN', { month: 'short' })
}

export function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}
