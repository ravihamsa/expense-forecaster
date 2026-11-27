import { budgetPeriod } from './budgets'
import { formatMoney, formatPercent } from './format'
import { expectedMonthlyIncome, isDiscretionary, loanPayoffMonths, loanTotalInterest, simulate } from './projections'
import type { Advice, AppData, Simulation, SimulationOptions } from './types'

export function buildAdvice(data: AppData, base: Simulation): Advice[] {
  const { profile, loans } = data
  const currency = profile.currency || 'INR'
  const money = (value: number) => formatMoney(value, currency)
  const advice: Advice[] = []
  const averageIncome = base.months.length
    ? base.months.reduce((sum, month) => sum + expectedMonthlyIncome(data, month.key), 0) / base.months.length
    : 0

  if (averageIncome <= 0) {
    advice.push({
      id: 'setup-income',
      title: 'Plan your expected income to unlock forecasts',
      detail: 'Your plan needs a starting point. Set the take-home you expect for each month in the dashboard’s Month preview — it can change month to month.',
      impact: 'Required to calculate surplus and deficit',
      tone: 'warn',
    })
  }

  const discretionaryMonthly = data.budgets
    .filter((budget) => isDiscretionary(budget.category))
    .reduce((sum, budget) => {
      const period = budgetPeriod(budget)
      if (period === 'monthly') return sum + Math.max(0, budget.monthly_limit)
      if (period === 'yearly') return sum + Math.max(0, budget.monthly_limit) / 12
      return sum
    }, 0)

  if (base.deficitMonths > 0) {
    const neededPerMonth = base.totalDeficit / base.deficitMonths
    const cutPct = discretionaryMonthly > 0 ? Math.min(80, Math.round((neededPerMonth / discretionaryMonthly) * 100)) : 0
    const trimmed = simulate(data, {
      expenseCutPct: cutPct,
      extraLoanPayment: 0,
      extraPaymentLoanId: 'highest_rate',
    })
    const firstDeficit = base.months.find((month) => month.net < 0)
    advice.push({
      id: 'trim-spend',
      title: `${base.deficitMonths} month${base.deficitMonths === 1 ? '' : 's'} of deficit ahead`,
      detail: `Your first shortfall is ${firstDeficit?.label ?? 'soon'}, about ${money(neededPerMonth)} per affected month. Trimming ${cutPct}% from flexible categories like Shopping, Dining and Subscriptions would close the gap.`,
      impact: `${base.deficitMonths} deficit months → ${trimmed.deficitMonths}, balance ${money(trimmed.endingBalance - base.endingBalance)} better`,
      tone: 'warn',
      action: { label: 'Review planned spends', tab: 'budgets' },
    })
  } else if (averageIncome > 0) {
    advice.push({
      id: 'steady-cashflow',
      title: 'Your cash flow stays positive',
      detail: 'No monthly deficits in the current forecast. Keep an eye on one-time expenses you have not scheduled yet.',
      impact: `${base.surplusMonths} surplus month${base.surplusMonths === 1 ? '' : 's'} in the next ${profile.horizon_months} months`,
      tone: 'good',
    })
  }

  if (base.endingBalance < 0) {
    advice.push({
      id: 'negative-balance',
      title: 'Your projected balance goes below zero',
      detail: 'Even if monthly net turns positive later, starting deficits can create a cash crunch. Consider building a buffer or moving a large planned expense to a later month.',
      impact: `Lowest projected balance: ${money(base.lowestBalance)}`,
      tone: 'warn',
      action: { label: 'Open calendar', tab: 'calendar' },
    })
  }

  const borrowed = loans.filter((loan) => loan.direction === 'borrowed' && loan.outstanding > 0)
  const expensive = [...borrowed].sort((a, b) => b.interest_rate - a.interest_rate)[0]
  if (expensive) {
    const extra = Math.max(500, Math.round((averageIncome * 0.05) / 500) * 500)
    const beforeMonths = loanPayoffMonths(expensive, 0, data.loanPayments)
    const afterMonths = loanPayoffMonths(expensive, extra, data.loanPayments)
    const interestSaved = loanTotalInterest(expensive, 0, data.loanPayments) - loanTotalInterest(expensive, extra, data.loanPayments)
    const accelerated = simulate(data, {
      expenseCutPct: 0,
      extraLoanPayment: extra,
      extraPaymentLoanId: expensive.id,
    })
    const monthsSaved = beforeMonths !== null && afterMonths !== null ? beforeMonths - afterMonths : null
    const extraCleared = accelerated.payoff.length - base.payoff.length
    advice.push({
      id: 'clear-loan',
      title: `Tackle ${expensive.name} first`,
      detail: `It has the highest interest rate (${formatPercent(expensive.interest_rate)}). An extra ${money(extra)} per month toward it would shorten its life${monthsSaved && monthsSaved > 0 ? ` by about ${monthsSaved} month${monthsSaved === 1 ? '' : 's'}` : ''} and save ${money(interestSaved)} in interest.`,
      impact: extraCleared > 0
        ? `${extraCleared} more loan${extraCleared === 1 ? '' : 's'} clear${extraCleared === 1 ? 's' : ''} within the forecast window`
        : `${money(interestSaved)} interest saved over the forecast window`,
      tone: monthsSaved && monthsSaved > 0 ? 'good' : 'info',
      action: { label: 'View loans', tab: 'loans' },
    })

    const negativeAmortizing = borrowed.find(
      (loan) => loan.repayment_type === 'emi' && loan.emi <= loan.outstanding * (loan.interest_rate / 100 / 12),
    )
    if (negativeAmortizing) {
      advice.push({
        id: 'cover-interest',
        title: `${negativeAmortizing.name} EMI barely covers interest`,
        detail: `At ${formatPercent(negativeAmortizing.interest_rate)} interest, the current EMI does not reduce the principal. Increase the EMI or make regular prepayments so the loan does not keep growing.`,
        impact: 'Without a change, the outstanding balance will rise',
        tone: 'warn',
        action: { label: 'Update loan', tab: 'loans' },
      })
    }
  }

  const lent = loans.filter((loan) => loan.direction === 'lent' && loan.outstanding > 0)
  if (lent.length) {
    const unscheduled = lent.filter((loan) => !loan.due_date && !data.loanPayments.some((payment) => payment.loan_id === loan.id))
    const receivable = lent.reduce((sum, loan) => sum + loan.outstanding, 0)
    advice.push({
      id: 'track-lent',
      title: unscheduled.length ? `${unscheduled.length} loan${unscheduled.length === 1 ? '' : 's'} given without a repayment plan` : `${money(receivable)} is coming back to you`,
      detail: unscheduled.length
        ? 'Add an expected repayment date or record each lump sum you receive. Repayments are counted as income in the month they land.'
        : 'Your recorded repayments and expected dates are included in the forecast as inflows, so you can see exactly when the money returns.',
      impact: `${money(receivable)} owed to you across ${lent.length} loan${lent.length === 1 ? '' : 's'}`,
      tone: unscheduled.length ? 'warn' : 'good',
      action: { label: 'View loans', tab: 'loans' },
    })
  }

  if (base.surplusMonths > 0 && loans.length === 0 && averageIncome > 0) {
    const averageSurplus = base.months.reduce((sum, month) => sum + Math.max(0, month.net), 0) / base.months.length
    advice.push({
      id: 'build-buffer',
      title: 'Put your surplus to work',
      detail: `You have about ${money(averageSurplus)} of average monthly surplus and no loans. An emergency fund of 3–6 months of expenses would protect you from unexpected costs.`,
      impact: `Potential to save ${money(averageSurplus * 6)} in six months`,
      tone: 'good',
    })
  }

  return advice.slice(0, 6)
}

export function defaultSimulationOptions(data: AppData): SimulationOptions {
  return {
    expenseCutPct: 0,
    extraLoanPayment: 0,
    extraPaymentLoanId: data.loans[0]?.id ?? 'highest_rate',
  }
}
