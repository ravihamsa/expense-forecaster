import type { Actual, AppData, Budget, BudgetPeriod, FlowEvent, MonthProjection } from './types'

const LEGACY_START_DATE = '1970-01-01'

/** One expense occurrence that feeds a budget month's spent amount. */
export interface BudgetExpense {
  id: string
  name: string
  date: string
  planned: number
  recorded?: number
  /** Amount that actually counted toward this budget month. */
  counted: number
  accountLabel: string
  note: string
  source: string
}

export interface BudgetMonthStatus {
  key: string
  label: string
  planned: number
  recorded: number
  spent: number
  carriedIn: number
  carriedOut: number
  available: number
  remaining: number
  /** Whether this allocation applies to this projection month. */
  active: boolean
  /** Expense occurrences behind the spent amount, largest contributors first. */
  expenses: BudgetExpense[]
}

export interface BudgetStatus {
  budget: Budget
  months: BudgetMonthStatus[]
  plannedTotal: number
  recordedTotal: number
  spentTotal: number
  currentRemaining: number
  currentRow?: BudgetMonthStatus
  periodLabel: string
}

export function budgetPeriod(budget: Budget): BudgetPeriod {
  return budget.period === 'yearly' || budget.period === 'one_time' ? budget.period : 'monthly'
}

export function budgetStartDate(budget: Budget): string {
  return budget.start_date || LEGACY_START_DATE
}

export function budgetKey(budget: Budget): string {
  return `${budget.category}|${budgetPeriod(budget)}|${budgetStartDate(budget)}`
}

export function budgetTitle(budget: Budget): string {
  return budget.name?.trim() || budget.category
}

export function budgetPeriodLabel(budget: Budget): string {
  const period = budgetPeriod(budget)
  if (period === 'yearly') return `Yearly · from ${budgetStartDate(budget).slice(0, 7)}`
  if (period === 'one_time') return `One-time · ${budgetStartDate(budget)}`
  return budget.rollover ? 'Monthly · rollover' : 'Monthly'
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The minimum month shape needed to match budgets and recorded spends. */
export type BudgetMonthView = Pick<MonthProjection, 'key' | 'year' | 'monthIndex'> & {
  events: FlowEvent[]
}

/** Stable id for a planned-spend occurrence, also used by recorded amounts. */
export function budgetEventId(budget: Budget, date: string): string {
  return `budget-${budget.id}-${date}`
}

export function standaloneActualEventId(actualId: string): string {
  return `actual-${actualId}`
}

/** The exact calendar date a plan lands on inside a projection month. */
export function budgetOccurrenceDate(
  budget: Budget,
  month: Pick<MonthProjection, 'key' | 'year' | 'monthIndex'>,
): string | null {
  const startDate = budgetStartDate(budget)
  const period = budgetPeriod(budget)
  if (period === 'monthly') {
    return dateKey(new Date(month.year, month.monthIndex, 1))
  }
  const startMonth = Number(startDate.slice(5, 7)) - 1
  if (!Number.isInteger(startMonth) || startMonth !== month.monthIndex) return null
  if (period === 'one_time') {
    return month.key === startDate.slice(0, 7) ? startDate : null
  }
  const startYear = Number(startDate.slice(0, 4)) || 1970
  if (month.year < startYear) return null
  const day = Number(startDate.slice(8, 10)) || 1
  const lastDay = new Date(month.year, month.monthIndex + 1, 0).getDate()
  return dateKey(new Date(month.year, month.monthIndex, Math.min(day, lastDay)))
}

function budgetEvents(month: BudgetMonthView, budget: Budget): FlowEvent[] {
  // Budgets are the only planned-spend source. The deprecated cash_flow_id and
  // category-only fallbacks are intentionally gone.
  return month.events.filter(
    (event) => event.kind === 'expense' && event.source === 'budget' && event.budgetId === budget.id,
  )
}

function plannedAmount(events: FlowEvent[]): number {
  return events.reduce((sum, event) => sum + event.amount, 0)
}

function yearlyCycleStartYear(startDate: string, month: BudgetMonthView): number | null {
  const startYear = Number(startDate.slice(0, 4)) || 1970
  const startMonth = Number(startDate.slice(5, 7)) - 1
  if (!Number.isFinite(startMonth) || startMonth < 0 || startMonth > 11) return null
  let year = month.year
  if (month.monthIndex < startMonth) year -= 1
  return year >= startYear ? year : null
}

interface MonthActuals {
  byEventId: Map<string, Actual>
}

type AssignedActuals = Map<string, Map<string, MonthActuals>>

function assignActuals(data: AppData, months: BudgetMonthView[]): AssignedActuals {
  const assigned: AssignedActuals = new Map()
  const claimed = new Set<string>()
  const expenses = (data.actuals ?? []).filter((actual) => actual.kind === 'expense')

  // Migration re-keys recorded spends to the exact budget occurrence they
  // replace. Only those direct matches count toward a budget.
  for (const month of months) {
    for (const budget of data.budgets ?? []) {
      let byBudget = assigned.get(budget.id)
      if (!byBudget) {
        byBudget = new Map()
        assigned.set(budget.id, byBudget)
      }
      let bucket = byBudget.get(month.key)
      if (!bucket) {
        bucket = { byEventId: new Map() }
        byBudget.set(month.key, bucket)
      }
      for (const event of budgetEvents(month, budget)) {
        const actual = expenses.find((entry) => !claimed.has(entry.id) && entry.event_key === event.id)
        if (!actual) continue
        claimed.add(actual.id)
        bucket.byEventId.set(event.id, actual)
      }
    }
  }

  return assigned
}

/**
 * Builds per-plan statuses. Legacy monthly plans keep their original
 * limit/rollover calculation: an unrecorded occurrence counts as planned until
 * a real spend appears. Yearly and one-time plans count only recorded spends so
 * a future plan is never reported as money already spent.
 */
export function buildBudgetStatuses(data: AppData, months: MonthProjection[]): BudgetStatus[] {
  const assigned = assignActuals(data, months)
  const accountNames = new Map((data.accounts ?? []).map((account) => [account.id, account.name]))

  return (data.budgets ?? []).map((budget) => {
    const period = budgetPeriod(budget)
    const startDate = budgetStartDate(budget)
    const amount = Math.max(0, Number(budget.monthly_limit) || 0)
    let carried = 0
    let plannedTotal = 0
    let recordedTotal = 0
    let spentTotal = 0
    const cycleRecorded = new Map<number, number>()

    const rows = months.map((month) => {
      const events = budgetEvents(month, budget)
      const bucket = assigned.get(budget.id)?.get(month.key)
      const eventActuals = bucket?.byEventId ?? new Map<string, Actual>()
      const monthActuals = [...eventActuals.values()]
      const hasRecorded = monthActuals.length > 0
      const planned = plannedAmount(events)
      const recorded = monthActuals.reduce((sum, actual) => sum + Math.max(0, actual.amount), 0)
      let spent = recorded
      let carriedIn = 0
      let available = 0
      let remaining = 0
      let carriedOut = 0
      let active = true

      if (period === 'monthly') {
        carriedIn = budget.rollover ? carried : 0
        available = amount + carriedIn
        if (hasRecorded) {
          // A real spend replaces the placeholder, even when it came from SMS.
          spent = recorded
          remaining = available - spent
          carriedOut = budget.rollover ? remaining : 0
          carried = carriedOut
        } else {
          // An unspent future month keeps any earlier carry moving forward; it
          // does not pre-spend a budget that has not happened yet.
          spent = planned
          remaining = 0
          carriedOut = budget.rollover ? carriedIn : 0
          carried = carriedOut
        }
      } else if (period === 'yearly') {
        const cycleYear = yearlyCycleStartYear(startDate, month)
        if (cycleYear !== null) {
          active = true
          const running = (cycleRecorded.get(cycleYear) ?? 0) + recorded
          cycleRecorded.set(cycleYear, running)
          available = amount - running
          remaining = available
        }
      } else {
        active = month.key === startDate.slice(0, 7)
        if (active) {
          available = amount
          remaining = amount - recorded
        }
      }

      const accountLabel = (value: string | undefined): string => (
        value ? accountNames.get(value) ?? value : ''
      )
      const actualSource = (actual: Actual): string => (
        actual.source === 'sms' ? 'SMS import' : 'Actual'
      )

      const expenses: BudgetExpense[] = [
        ...events.map((event) => {
          const actual = eventActuals.get(event.id)
          const counted = period === 'monthly'
            ? actual?.amount ?? (hasRecorded ? 0 : event.amount)
            : active
              ? actual?.amount ?? 0
              : 0
          return {
            id: event.id,
            name: event.name,
            date: event.date,
            planned: event.amount,
            recorded: actual?.amount,
            counted,
            accountLabel: accountLabel(actual?.account ?? event.account),
            note: actual?.note ?? '',
            source: actual ? actualSource(actual) : 'Planned',
          }
        }),
      ]
        .filter((item) => item.counted > 0)
        .sort((a, b) => b.counted - a.counted || a.date.localeCompare(b.date) || a.name.localeCompare(b.name))

      plannedTotal += planned
      recordedTotal += recorded
      spentTotal += spent
      return {
        key: month.key,
        label: month.monthLabel,
        planned,
        recorded,
        spent,
        carriedIn,
        carriedOut,
        available,
        remaining,
        active,
        expenses,
      }
    })

    const currentRow = rows.find((row) => row.active) ?? rows[0]
    return {
      budget,
      months: rows,
      plannedTotal,
      recordedTotal,
      spentTotal,
      currentRemaining: currentRow && currentRow.active ? currentRow.remaining : amount,
      currentRow,
      periodLabel: budgetPeriodLabel(budget),
    }
  })
}
