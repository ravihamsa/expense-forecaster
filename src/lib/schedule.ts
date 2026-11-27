import type { CashFlow, Recurrence } from './types'

function toDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth()
}

function occurrenceForMonth(flow: CashFlow, year: number, month: number): Date | null {
  const start = toDate(flow.start_date)
  const end = flow.end_date ? toDate(flow.end_date) : null
  const startIdx = monthIndex(start)
  const targetIdx = year * 12 + month
  if (targetIdx < startIdx) return null
  if (end && targetIdx > monthIndex(end)) return null

  const day = Math.min(start.getDate(), new Date(year, month + 1, 0).getDate())
  const candidate = new Date(year, month, day)
  if (end && candidate > end) return null

  switch (flow.recurrence) {
    case 'one_time':
      return targetIdx === startIdx ? candidate : null
    case 'monthly':
      return candidate
    case 'yearly':
      return month === start.getMonth() ? candidate : null
    case 'every_n_months':
      return (targetIdx - startIdx) % Math.max(1, flow.interval_count) === 0 ? candidate : null
    case 'every_n_years':
      return month === start.getMonth() &&
        (year - start.getFullYear()) % Math.max(1, flow.interval_count) === 0
        ? candidate
        : null
    default:
      return null
  }
}

/** All dates on which this cash flow occurs within a given calendar month. */
export function occurrencesInMonth(flow: CashFlow, year: number, month: number): Date[] {
  const date = occurrenceForMonth(flow, year, month)
  return date ? [date] : []
}

/** Next date on or after `from` (defaults to today) when this flow occurs. */
export function nextOccurrence(flow: CashFlow, from = new Date()): Date | null {
  const startIdx = monthIndex(toDate(flow.start_date))
  const first = Math.max(startIdx, monthIndex(from))
  for (let i = 0; i < 12 * 20; i += 1) {
    const idx = first + i
    const year = Math.floor(idx / 12)
    const month = idx % 12
    const date = occurrenceForMonth(flow, year, month)
    if (date && date >= new Date(from.getFullYear(), from.getMonth(), from.getDate())) return date
  }
  return null
}

const recurrenceLabels: Record<Recurrence, string> = {
  one_time: 'One-time',
  monthly: 'Monthly',
  yearly: 'Yearly',
  every_n_months: 'Every N months',
  every_n_years: 'Every N years',
}

export function recurrenceLabel(flow: CashFlow): string {
  if (flow.recurrence === 'every_n_months') return `Every ${flow.interval_count} month${flow.interval_count === 1 ? '' : 's'}`
  if (flow.recurrence === 'every_n_years') return `Every ${flow.interval_count} year${flow.interval_count === 1 ? '' : 's'}`
  return recurrenceLabels[flow.recurrence]
}

export function isFutureScheduled(flow: CashFlow): boolean {
  if (flow.recurrence === 'one_time') return toDate(flow.start_date) > new Date()
  const next = nextOccurrence(flow)
  return next ? dateKey(next) > dateKey(new Date()) : false
}

export function toDateInputValue(date = new Date()): string {
  return dateKey(date)
}
