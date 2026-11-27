import {
  ArrowRight,
  CheckCircle2,
  Info,
  RotateCcw,
  Scale,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { buildAdvice } from '../lib/advice'
import { formatCompact, formatMoney, formatSigned } from '../lib/format'
import { isDiscretionary } from '../lib/projections'
import type { AppData, Simulation, SimulationOptions, Tab } from '../lib/types'

interface Props {
  data: AppData
  baseSimulation: Simulation
  simulation: Simulation
  options: SimulationOptions
  onOptionsChange: (options: SimulationOptions) => void
  onNavigate: (tab: Tab) => void
}

function monthlyEquivalent(amount: number, recurrence: string, interval: number): number {
  switch (recurrence) {
    case 'monthly': return amount
    case 'yearly': return amount / 12
    case 'every_n_months': return amount / Math.max(1, interval)
    case 'every_n_years': return amount / (12 * Math.max(1, interval))
    default: return 0
  }
}

export default function BalancePlan({ data, baseSimulation, simulation, options, onOptionsChange, onNavigate }: Props) {
  const currency = data.profile.currency || 'INR'
  const advice = buildAdvice(data, baseSimulation)
  const discretionaryMonthly = data.cashFlows
    .filter((flow) => flow.kind === 'expense' && isDiscretionary(flow))
    .reduce((sum, flow) => sum + monthlyEquivalent(flow.amount, flow.recurrence, flow.interval_count), 0)
  const monthlySaving = discretionaryMonthly * (options.expenseCutPct / 100)

  const deficitChange = baseSimulation.deficitMonths - simulation.deficitMonths
  const balanceChange = simulation.endingBalance - baseSimulation.endingBalance
  const interestSaved = baseSimulation.totalInterest - simulation.totalInterest
  const extraCleared = simulation.payoff.length - baseSimulation.payoff.length
  const hasAdjustment = options.expenseCutPct > 0 || options.extraLoanPayment > 0

  const chartData = baseSimulation.months.map((month, index) => ({
    label: month.monthLabel,
    before: month.net,
    after: simulation.months[index]?.net ?? 0,
  }))

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Balance</span>
          <h1>Balance your finances</h1>
          <p>Try small changes and see instantly how they reshape your deficits, balance and loan payoff.</p>
        </div>
        <button
          className="btn btn-outline"
          onClick={() => onOptionsChange({ expenseCutPct: 0, extraLoanPayment: 0, extraPaymentLoanId: 'highest_rate' })}
        >
          <RotateCcw size={16} /> Reset
        </button>
      </header>

      <section className="card adjust-card">
        <div className="card-head">
          <div>
            <h2>What-if adjustments</h2>
            <p>Sliders change the forecast only — your saved data stays untouched.</p>
          </div>
          <span className="status-pill pill-blue"><Sparkles size={14} /> Live simulation</span>
        </div>
        <div className="adjust-grid">
          <div className="adjust-control">
            <div className="adjust-head">
              <span>Trim flexible spending</span>
              <strong>{options.expenseCutPct}%</strong>
            </div>
            <input
              className="range-input"
              type="range"
              min="0"
              max="60"
              step="5"
              value={options.expenseCutPct}
              onChange={(e) => onOptionsChange({ ...options, expenseCutPct: Number(e.target.value) })}
            />
            <div className="range-labels"><span>0%</span><span>60%</span></div>
            <p className="adjust-hint">
              {discretionaryMonthly > 0
                ? `About ${formatMoney(monthlySaving, currency)} per month from shopping, dining, subscriptions and similar categories.`
                : 'Add an expense in a flexible category (Shopping, Dining, Travel…) to use this slider.'}
            </p>
          </div>

          <div className="adjust-control">
            <div className="adjust-head">
              <span>Extra loan payment / month</span>
              <strong>{formatMoney(options.extraLoanPayment, currency)}</strong>
            </div>
            <div className="quick-amounts">
              {[0, 500, 1000, 2500, 5000].map((value) => (
                <button
                  key={value}
                  className={options.extraLoanPayment === value ? 'quick-active' : ''}
                  onClick={() => onOptionsChange({ ...options, extraLoanPayment: value })}
                >
                  {value === 0 ? 'None' : formatCompact(value, currency)}
                </button>
              ))}
            </div>
            <label className="field compact-field">
              <span>Prepay toward</span>
              <select
                value={options.extraPaymentLoanId}
                onChange={(e) => onOptionsChange({ ...options, extraPaymentLoanId: e.target.value })}
              >
                <option value="highest_rate">Highest interest loan first</option>
                {data.loans.filter((loan) => loan.direction === 'borrowed').map((loan) => <option key={loan.id} value={loan.id}>{loan.name}</option>)}
              </select>
            </label>
            <p className="adjust-hint">Anything left after that loan is cleared flows to the next highest-interest loan.</p>
          </div>
        </div>
      </section>

      <section className="impact-grid">
        <article className={`impact-card ${deficitChange > 0 ? 'impact-good' : ''}`}>
          <span>Deficit months</span>
          <strong>{simulation.deficitMonths}</strong>
          <small>{deficitChange > 0 ? `${deficitChange} fewer than now` : deficitChange < 0 ? `${Math.abs(deficitChange)} more than now` : 'Same as current plan'}</small>
        </article>
        <article className={`impact-card ${balanceChange > 0 ? 'impact-good' : ''}`}>
          <span>Ending balance</span>
          <strong>{formatMoney(simulation.endingBalance, currency)}</strong>
          <small>{balanceChange !== 0 ? `${formatSigned(balanceChange, currency)} vs current plan` : 'No change yet'}</small>
        </article>
        <article className={`impact-card ${interestSaved > 0 ? 'impact-good' : ''}`}>
          <span>Interest saved</span>
          <strong>{formatMoney(interestSaved, currency)}</strong>
          <small>Over the forecast window</small>
        </article>
        <article className={`impact-card ${extraCleared > 0 ? 'impact-good' : ''}`}>
          <span>Loans cleared</span>
          <strong>{simulation.payoff.length}</strong>
          <small>{extraCleared > 0 ? `${extraCleared} sooner than now` : `${data.loans.length} loan${data.loans.length === 1 ? '' : 's'} tracked`}</small>
        </article>
      </section>

      {hasAdjustment && (
        <section className="card chart-card">
          <div className="card-head">
            <div>
              <h2>Before vs after</h2>
              <p>Monthly net cash flow with and without your adjustments</p>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#22313d" />
                <XAxis dataKey="label" tick={{ fill: '#8296a6', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value: number) => formatCompact(value, currency)} tick={{ fill: '#8296a6', fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
                <Tooltip formatter={(value) => formatMoney(Number(value), currency)} contentStyle={{ background: '#101d27', border: '1px solid #253745', borderRadius: 12, color: '#e6f0f5' }} />
                <Bar dataKey="before" name="Current plan" fill="#546b7c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="after" name="Adjusted plan" fill="#2dd4a7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Suggested moves</h2>
            <p>Based on your current plan, before adjustments</p>
          </div>
          <span className="status-pill pill-blue"><Scale size={14} /> {advice.length} insights</span>
        </div>
        <div className="advice-grid">
          {advice.map((item) => (
            <article className={`advice-card tone-${item.tone}`} key={item.id}>
              <div className="advice-icon">
                {item.tone === 'warn' ? <TriangleAlert size={18} /> : item.tone === 'good' ? <CheckCircle2 size={18} /> : <Info size={18} />}
              </div>
              <div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <div className="advice-impact"><TrendingUp size={14} /> {item.impact}</div>
                {item.action && (
                  <button className="text-action" onClick={() => onNavigate(item.action!.tab)}>
                    {item.action.label} <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
