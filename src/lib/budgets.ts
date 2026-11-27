import type { AppData, Budget, MonthProjection } from './types'

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
}

export interface BudgetStatus {
  budget: Budget
  months: BudgetMonthStatus[]
  plannedTotal: number
  recordedTotal: number
  spentTotal: number
  currentRemaining: number
}

/**
 * Builds a per-category budget with optional rollover. Each planned event uses
 * its recorded amount when one exists, otherwise the forecast amount, so
 * partially recorded months are handled correctly.
 */
export function buildBudgetStatuses(data: AppData, months: MonthProjection[]): BudgetStatus[] {
  const actuals = new Map((data.actuals ?? []).map((actual) => [actual.event_key, actual]))

  return (data.budgets ?? []).map((budget) => {
    let carried = 0
    let plannedTotal = 0
    let recordedTotal = 0
    let spentTotal = 0
    const rows = months.map((month) => {
      const events = month.events.filter(
        (event) => event.kind === 'expense' && event.category === budget.category,
      )
      const planned = events.reduce((sum, event) => sum + event.amount, 0)
      const recorded = events.reduce((sum, event) => sum + (actuals.get(event.id)?.amount ?? 0), 0)
      const spent = events.reduce(
        (sum, event) => sum + (actuals.get(event.id)?.amount ?? event.amount),
        0,
      )
      const carriedIn = budget.rollover ? carried : 0
      const available = budget.monthly_limit + carriedIn
      const remaining = available - spent
      const carriedOut = budget.rollover ? remaining : 0
      carried = carriedOut
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
      }
    })

    return {
      budget,
      months: rows,
      plannedTotal,
      recordedTotal,
      spentTotal,
      currentRemaining: rows[0]?.remaining ?? budget.monthly_limit,
    }
  })
}
