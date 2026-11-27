import type { AppData, Budget, BudgetPeriod, FlowEvent, MonthProjection } from './types'

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

function categoryEvents(month: MonthProjection, category: string): FlowEvent[] {
  return month.events.filter((event) => event.kind === 'expense' && event.category === category)
}

function plannedAmount(events: FlowEvent[]): number {
  return events.reduce((sum, event) => sum + event.amount, 0)
}

function recordedAmount(
  events: FlowEvent[],
  actuals: Map<string, { amount: number }>,
): number {
  return events.reduce((sum, event) => sum + (actuals.get(event.id)?.amount ?? 0), 0)
}

function yearlyCycleStartYear(startDate: string, month: MonthProjection): number | null {
  const startYear = Number(startDate.slice(0, 4)) || 1970
  const startMonth = Number(startDate.slice(5, 7)) - 1
  if (!Number.isFinite(startMonth) || startMonth < 0 || startMonth > 11) return null
  let year = month.year
  if (month.monthIndex < startMonth) year -= 1
  return year >= startYear ? year : null
}

/**
 * Builds per-allocation statuses. Legacy monthly budgets keep their original
 * behaviour: each month gets the full limit, rollover carries forward, and an
 * unrecorded forecast event counts as spent. Yearly and one-time allocations
 * are dated, apply only in their window, and count only recorded actuals so a
 * future plan is not reported as money already spent.
 */
export function buildBudgetStatuses(data: AppData, months: MonthProjection[]): BudgetStatus[] {
  const actuals = new Map((data.actuals ?? []).map((actual) => [actual.event_key, actual]))
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
      const events = categoryEvents(month, budget.category)
      const planned = plannedAmount(events)
      const recorded = recordedAmount(events, actuals)
      let spent = recorded
      let carriedIn = 0
      let available = 0
      let remaining = 0
      let carriedOut = 0
      let active = true

      if (period === 'monthly') {
        // Preserve the original monthly-limit and rollover calculation.
        spent = events.reduce(
          (sum, event) => sum + (actuals.get(event.id)?.amount ?? event.amount),
          0,
        )
        carriedIn = budget.rollover ? carried : 0
        available = amount + carriedIn
        remaining = available - spent
        carriedOut = budget.rollover ? remaining : 0
        carried = carriedOut
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
        const targetMonth = startDate.slice(0, 7)
        active = month.key === targetMonth
        if (active) {
          available = amount
          remaining = amount - recorded
        }
      }

      const expenses: BudgetExpense[] = events
        .map((event) => {
          const actual = actuals.get(event.id)
          const recordedValue = actual?.amount
          const counted = period === 'monthly'
            ? recordedValue ?? event.amount
            : active
              ? recordedValue ?? 0
              : 0
          return {
            id: event.id,
            name: event.name,
            date: event.date,
            planned: event.amount,
            recorded: recordedValue,
            counted,
            accountLabel: event.account ? accountNames.get(event.account) ?? event.account : '',
            note: actual?.note ?? '',
            source: actual ? (actual.source === 'sms' ? 'SMS import' : 'Actual') : 'Planned',
          }
        })
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
