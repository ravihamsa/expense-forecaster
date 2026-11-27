import type { AppData, Goal, Simulation } from './types'

export interface GoalStatus {
  goal: Goal
  remaining: number
  monthsRemaining: number
  requiredMonthly: number
  projectedAmount: number
  projectedGap: number
  progress: number
  onTrack: boolean
}

export interface GoalsSummary {
  statuses: GoalStatus[]
  totalContribution: number
  totalRequired: number
  forecastSurplus: number
  overCommitted: boolean
}

function monthsUntil(targetDate: string | null, from: Date, fallback: number): number {
  if (!targetDate) return Math.max(1, fallback)
  const [year, month] = targetDate.split('-').map(Number)
  if (!year || !month) return Math.max(1, fallback)
  const difference = (year - from.getFullYear()) * 12 + (month - 1) - from.getMonth() + 1
  return Math.max(1, difference)
}

export function buildGoalsSummary(data: AppData, simulation: Simulation, from = new Date()): GoalsSummary {
  const fallbackMonths = Math.max(1, data.profile.horizon_months || 12)
  const statuses: GoalStatus[] = (data.goals ?? []).map((goal) => {
    const target = Math.max(0, goal.target_amount)
    const current = Math.max(0, goal.current_amount)
    const remaining = Math.max(0, target - current)
    const monthsRemaining = monthsUntil(goal.target_date, from, fallbackMonths)
    const requiredMonthly = remaining / monthsRemaining
    const monthly = Math.max(0, goal.monthly_contribution)
    const projectedAmount = current + monthly * monthsRemaining
    return {
      goal,
      remaining,
      monthsRemaining,
      requiredMonthly,
      projectedAmount,
      projectedGap: Math.max(0, target - projectedAmount),
      progress: target > 0 ? Math.min(100, (current / target) * 100) : 100,
      onTrack: remaining <= 0 || monthly + 0.005 >= requiredMonthly,
    }
  })

  const totalContribution = statuses.reduce((sum, status) => sum + status.goal.monthly_contribution, 0)
  const totalRequired = statuses.reduce((sum, status) => sum + status.requiredMonthly, 0)
  const forecastSurplus = simulation.months.length
    ? simulation.months.reduce((sum, month) => sum + Math.max(0, month.net), 0) / simulation.months.length
    : 0

  return {
    statuses,
    totalContribution,
    totalRequired,
    forecastSurplus,
    overCommitted: totalContribution > forecastSurplus + 0.005,
  }
}
