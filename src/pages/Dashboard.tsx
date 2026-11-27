import { useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Landmark,
  PiggyBank,
  Plus,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import FundingView from '../components/FundingView'
import MonthPreview from '../components/MonthPreview'
import { budgetPeriod } from '../lib/budgets'
import { formatCompact, formatMoney, formatSigned, monthKey, shortMonthLabel } from '../lib/format'
import { summarizeLoans } from '../lib/loans'
import { expectedMonthlyIncome, loanPayoffMonths } from '../lib/projections'
import { nextOccurrence, recurrenceLabel, toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, FlowKind, MonthProjection, Simulation, Tab } from '../lib/types'

interface Props {
  data: AppData
  simulation: Simulation
  actions: AppActions
  onNotify: (message: string) => void
  onNavigate: (tab: Tab) => void
  onAdd: (kind: FlowKind) => void
  onAddLoan: () => void
}

function ForecastTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean
  payload?: { payload: MonthProjection }[]
  currency: string
}) {
  if (!active || !payload?.length) return null
  const month = payload[0].payload
  return (
    <div className="chart-tooltip">
      <strong>{month.label}</strong>
      <div><span>Net this month</span><b className={month.net >= 0 ? 'positive' : 'negative'}>{formatSigned(month.net, currency)}</b></div>
      <div><span>Carried in</span><b>{formatMoney(month.openingBalance, currency)}</b></div>
      <div><span>Carried forward</span><b>{formatMoney(month.closingBalance, currency)}</b></div>
      <div><span>To savings funds</span><b>{formatMoney(month.savingsContributions, currency)}</b></div>
      <div><span>Spendable balance</span><b>{formatMoney(month.spendableBalance, currency)}</b></div>
      <div><span>Planned income</span><b>{formatMoney(month.income + month.loanInflows, currency)}</b></div>
      <div><span>Planned spends</span><b>{formatMoney(month.expenses + month.loanPayments, currency)}</b></div>
    </div>
  )
}

export default function Dashboard({ data, simulation, actions, onNotify, onNavigate, onAdd, onAddLoan }: Props) {
  const { profile, cashFlows, loans } = data
  const currency = profile.currency || 'INR'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const [previewMonth, setPreviewMonth] = useState(simulation.months[0]?.key ?? '')

  const budgetExpenses = data.budgets.reduce((sum, budget) => {
    const period = budgetPeriod(budget)
    if (period === 'monthly') return sum + Math.max(0, budget.monthly_limit)
    if (period === 'yearly') return sum + Math.max(0, budget.monthly_limit) / 12
    return sum
  }, 0)
  const loanTotals = summarizeLoans(loans)
  const monthlyExpenses = budgetExpenses + loanTotals.monthlyEmi
  const monthlySavings = (data.goals ?? []).reduce((sum, goal) => sum + Math.max(0, goal.monthly_contribution), 0)

  const firstMonthKey = simulation.months[0]?.key ?? ''
  const plannedIncome = firstMonthKey ? expectedMonthlyIncome(data, firstMonthKey) : 0
  const netMonthly = plannedIncome + loanTotals.monthlyReceivable - monthlyExpenses - monthlySavings
  const deficitMonths = simulation.months.filter((month) => month.net < 0)
  const surplusMonths = simulation.months.filter((month) => month.net >= 0)

  interface UpcomingItem {
    id: string
    name: string
    detail: string
    date: Date
    amount: number
    kind: FlowKind
  }

  const today = toDateInputValue()
  const upcoming: UpcomingItem[] = [
    ...simulation.months.flatMap((month) => month.events
      .filter((event) => event.source === 'budget' && event.date >= today)
      .map((event) => ({
        id: event.id,
        name: event.name,
        detail: 'Planned spend',
        date: new Date(`${event.date}T00:00:00`),
        amount: event.amount,
        kind: event.kind,
      }))),
    ...cashFlows
      .filter((flow) => flow.kind === 'income')
      .map((flow) => {
        const date = nextOccurrence(flow)
        if (!date) return null
        const key = monthKey(date.getFullYear(), date.getMonth())
        const fixed = data.cashFlowOverrides.find(
          (override) => override.cash_flow_id === flow.id && override.month === key,
        )
        return {
          id: flow.id,
          name: flow.name,
          detail: recurrenceLabel(flow),
          date,
          amount: fixed ? fixed.amount : flow.amount,
          kind: flow.kind,
        }
      })
      .filter((item): item is UpcomingItem => item !== null),
    ...loans
      .filter((loan) => loan.outstanding > 0 && loan.repayment_type === 'one_time' && loan.due_date)
      .map((loan) => ({
        id: `loan-${loan.id}`,
        name: loan.direction === 'lent' ? `${loan.name} repays you` : `Repay ${loan.name}`,
        detail: loan.direction === 'lent' ? 'Money coming back' : 'Hand loan repayment',
        date: new Date(`${loan.due_date}T00:00:00`),
        amount: loan.outstanding,
        kind: (loan.direction === 'lent' ? 'income' : 'expense') as FlowKind,
      })),
    ...data.loanPayments
      .filter((payment) => !payment.applied_to_balance && new Date(`${payment.payment_date}T00:00:00`) >= new Date(new Date().toDateString()))
      .map((payment) => {
        const loan = loans.find((candidate) => candidate.id === payment.loan_id)
        return {
          id: `payment-${payment.id}`,
          name: loan?.direction === 'lent' ? `${loan.name} repays you` : `${loan?.name ?? 'Loan'} payment`,
          detail: loan?.direction === 'lent' ? 'Repayment received' : 'One-time loan payment',
          date: new Date(`${payment.payment_date}T00:00:00`),
          amount: payment.amount,
          kind: (loan?.direction === 'lent' ? 'income' : 'expense') as FlowKind,
        }
      }),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5)

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>{greeting}, {profile.display_name?.split(' ')[0] || 'there'} 👋</h1>
          <p>Here is the next {profile.horizon_months} months of your money at a glance.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={() => onAdd('income')}><Plus size={16} /> Planned income</button>
          <button className="btn btn-outline" onClick={() => onAdd('expense')}><Plus size={16} /> Planned spend</button>
          <button className="btn btn-primary" onClick={onAddLoan}><Landmark size={16} /> Loan</button>
        </div>
      </header>

      {plannedIncome <= 0 && (
        <div className="notice-banner">
          <AlertTriangle size={19} />
          <div>
            <strong>Plan your expected income to get a real forecast.</strong>
            <span>Set it month by month in the preview below — it can change whenever your pay does.</span>
          </div>
          <button
            className="btn btn-small btn-outline"
            onClick={() => document.getElementById('month-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Set in month preview
          </button>
        </div>
      )}

      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-teal"><ArrowUpRight size={19} /></div>
          <span className="kpi-label">Planned income</span>
          <strong className="kpi-value">{formatMoney(plannedIncome, currency)}</strong>
          <span className="kpi-foot">{simulation.months[0]?.label ?? 'Current month'} · salary and other income</span>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon kpi-blue"><ArrowDownRight size={19} /></div>
          <span className="kpi-label">Planned spends</span>
          <strong className="kpi-value">{formatMoney(monthlyExpenses, currency)}</strong>
          <span className="kpi-foot">This month's plan, including EMIs</span>
        </article>
        <article className="kpi-card">
          <div className={`kpi-icon ${netMonthly >= 0 ? 'kpi-green' : 'kpi-red'}`}><TrendingUp size={19} /></div>
          <span className="kpi-label">Needed / free</span>
          <strong className={`kpi-value ${netMonthly >= 0 ? 'positive' : 'negative'}`}>{formatSigned(netMonthly, currency)}</strong>
          <span className="kpi-foot">After planned spends and savings funds</span>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon kpi-amber"><Landmark size={19} /></div>
          <span className="kpi-label">You owe</span>
          <strong className="kpi-value">{formatCompact(loanTotals.owed, currency)}</strong>
          <span className="kpi-foot">
            {loanTotals.activeBorrowedCount} active of {loanTotals.borrowedCount} loan{loanTotals.borrowedCount === 1 ? '' : 's'} taken
          </span>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon kpi-green"><TrendingUp size={19} /></div>
          <span className="kpi-label">Owed to you</span>
          <strong className="kpi-value positive">{formatCompact(loanTotals.receivable, currency)}</strong>
          <span className="kpi-foot">
            {loanTotals.activeLentCount} active of {loanTotals.lentCount} loan{loanTotals.lentCount === 1 ? '' : 's'} given
          </span>
        </article>
      </section>

      <FundingView data={data} simulation={simulation} currency={currency} />

      <section className="card chart-card">
        <div className="card-head">
          <div>
            <h2>Cash flow forecast</h2>
            <p>Monthly net (bars), money carried forward and spendable balance (lines) · includes your opening balance</p>
          </div>
          <div className="chart-legend">
            <span><i className="legend-dot legend-green" /> Surplus</span>
            <span><i className="legend-dot legend-red" /> Deficit</span>
            <span><i className="legend-line" /> Carried forward</span>
            <span><i className="legend-line legend-line-dashed" /> Spendable</span>
          </div>
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={310}>
            <ComposedChart data={simulation.months} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#22313d" />
              <XAxis dataKey="monthLabel" tickFormatter={(_, index) => shortMonthLabel(simulation.months[index]?.year ?? 0, simulation.months[index]?.monthIndex ?? 0)} tick={{ fill: '#8296a6', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value: number) => formatCompact(value, currency)} tick={{ fill: '#8296a6', fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<ForecastTooltip currency={currency} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <ReferenceLine y={0} stroke="#4a5b69" />
              <Bar
                dataKey="net"
                radius={[5, 5, 0, 0]}
                maxBarSize={34}
                onClick={(_, index) => {
                  const key = simulation.months[index]?.key
                  if (key) setPreviewMonth(key)
                }}
              >
                {simulation.months.map((month) => (
                  <Cell key={month.key} fill={month.net >= 0 ? '#2dd4a7' : '#ff6b6b'} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="closingBalance" stroke="#7aa7ff" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="spendableBalance" stroke="#ffc978" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-summary">
          <div><span className="summary-pip pip-red" /><strong>{deficitMonths.length}</strong> net-deficit month{deficitMonths.length === 1 ? '' : 's'}</div>
          <div><span className="summary-pip pip-green" /><strong>{surplusMonths.length}</strong> net-surplus month{surplusMonths.length === 1 ? '' : 's'}</div>
          <div><span className="summary-pip pip-blue" />Lowest carried balance <strong>{formatMoney(simulation.lowestBalance, currency)}</strong></div>
          <div>Lowest spendable <strong>{formatMoney(simulation.lowestSpendable, currency)}</strong></div>
          <div>Carried to end <strong>{formatMoney(simulation.endingBalance, currency)}</strong></div>
          <button className="link-button" onClick={() => onNavigate('balance')}>Open balance plan <ChevronRight size={15} /></button>
        </div>
      </section>

      <MonthPreview
        data={data}
        months={simulation.months}
        selectedKey={previewMonth}
        onSelect={setPreviewMonth}
        currency={currency}
        actions={actions}
        onNotify={onNotify}
        onAddIncome={() => onAdd('income')}
        onAddExpense={() => onAdd('expense')}
      />

      <div className="two-column">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Months needing extra funds</h2>
              <p>Where planned spends exceed planned income</p>
            </div>
            <span className={`status-pill ${deficitMonths.length ? 'pill-red' : 'pill-green'}`}>
              {deficitMonths.length ? `${deficitMonths.length} found` : 'All clear'}
            </span>
          </div>
          {deficitMonths.length ? (
            <div className="mini-list">
              {deficitMonths.slice(0, 5).map((month) => (
                <div className="mini-row" key={month.key}>
                  <span className="date-chip"><CalendarClock size={15} /> {month.monthLabel}</span>
                  <div className="mini-row-detail">
                    <strong className="negative">−{formatMoney(Math.abs(month.net), currency)}</strong>
                    <span>Balance {formatMoney(month.closingBalance, currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <PiggyBank size={26} />
              <strong>No extra funds needed</strong>
              <span>Your planned income covers every planned spend.</span>
            </div>
          )}

          {surplusMonths.length > 0 && (
            <div className="surplus-block">
              <span className="mini-subhead">Free money ahead</span>
              {surplusMonths.slice(0, 3).map((month) => (
                <div className="mini-row" key={`surplus-${month.key}`}>
                  <span className="date-chip"><TrendingUp size={15} /> {month.monthLabel}</span>
                  <div className="mini-row-detail">
                    <strong className="positive">+{formatMoney(month.net, currency)}</strong>
                    <span>Balance {formatMoney(month.closingBalance, currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="text-action" onClick={() => onNavigate('cashflows')}>Review cash flow <ChevronRight size={15} /></button>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Loan payoff</h2>
              <p>When each loan clears at current EMIs</p>
            </div>
            <button className="icon-button" onClick={onAddLoan} title="Add loan"><Plus size={17} /></button>
          </div>
          {loans.length ? (
            <div className="mini-list">
              {loans.slice(0, 5).map((loan) => {
                const months = loanPayoffMonths(loan, 0, data.loanPayments)
                const withinWindow = simulation.payoff.find((item) => item.loanId === loan.id)
                const isLent = loan.direction === 'lent'
                return (
                  <div className="mini-row" key={loan.id}>
                    <div>
                      <strong>{loan.name} {isLent && <span className="mini-tag">lent</span>}</strong>
                      <span>
                        {formatMoney(loan.outstanding, currency)} {isLent ? 'owed to you' : 'left'}
                        {!isLent && loan.emi > 0 ? ` · ${formatMoney(loan.emi, currency)}/mo` : ''}
                      </span>
                    </div>
                    <span className={`status-pill ${months === null ? 'pill-red' : withinWindow ? 'pill-green' : 'pill-blue'}`}>
                      {months === 0 ? (isLent ? 'Repaid' : 'Cleared')
                        : months === null ? 'No plan yet'
                          : withinWindow ? withinWindow.label
                            : `~${months} mo`}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state compact">
              <Landmark size={26} />
              <strong>No loans tracked</strong>
              <span>Add a loan to see payoff estimates here.</span>
            </div>
          )}
          <button className="text-action" onClick={() => onNavigate('loans')}>Manage loans <ChevronRight size={15} /></button>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Coming up</h2>
            <p>Your next planned spends and income</p>
          </div>
          <button className="icon-button" onClick={() => onNavigate('cashflows')} title="View all"><ArrowLeftRight size={17} /></button>
        </div>
        {upcoming.length ? (
          <div className="upcoming-grid">
            {upcoming.map((item) => (
              <div className="upcoming-item" key={item.id}>
                <span className={`flow-dot ${item.kind}`} />
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.detail} · {item.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <b className={item.kind === 'income' ? 'positive' : ''}>{item.kind === 'income' ? '+' : '−'}{formatMoney(item.amount, currency)}</b>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <CalendarClock size={26} />
            <strong>Nothing scheduled yet</strong>
            <span>Add monthly bills or one-time plans to see them here.</span>
          </div>
        )}
      </section>
    </div>
  )
}
