import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Wallet } from 'lucide-react'
import { formatMoney, formatSigned } from '../lib/format'
import type { AppData, FlowEvent, MonthProjection, Simulation } from '../lib/types'

interface Props {
  data: AppData
  simulation: Simulation
  currency: string
}

type BucketKey = 'monthly' | 'yearly' | 'one_time' | 'savings' | 'loans' | 'other'

interface Bucket {
  key: BucketKey
  label: string
  planned: number
  recorded: number
  count: number
}

interface FundingRow {
  month: MonthProjection
  moneyIn: number
  planned: number
  recorded: number
  opening: number
  closing: number
  savings: number
  spendable: number
  buckets: Bucket[]
}

const BUCKET_LABELS: Record<BucketKey, string> = {
  monthly: 'Monthly spends',
  yearly: 'Yearly spends',
  one_time: 'One-off spends',
  savings: 'Savings funds',
  loans: 'Loan payments',
  other: 'Other recurring',
}

const BUCKET_ORDER: BucketKey[] = ['monthly', 'yearly', 'one_time', 'savings', 'loans', 'other']

function bucketKey(event: FlowEvent, flowsById: Map<string, AppData['cashFlows'][number]>): BucketKey {
  if (event.source === 'loan' || event.source === 'extra_payment') return 'loans'
  const flow = event.cashFlowId ? flowsById.get(event.cashFlowId) : undefined
  if (!flow) return 'other'
  if (flow.recurrence === 'monthly') return 'monthly'
  if (flow.recurrence === 'yearly') return 'yearly'
  if (flow.recurrence === 'one_time') return 'one_time'
  return 'other'
}

export default function FundingView({ data, simulation, currency }: Props) {
  const [showAll, setShowAll] = useState(false)
  const flowsById = useMemo(
    () => new Map((data.cashFlows ?? []).map((flow) => [flow.id, flow])),
    [data.cashFlows],
  )

  const rows = useMemo<FundingRow[]>(
    () => simulation.months.map((month) => {
      const buckets = new Map<BucketKey, Bucket>(
        BUCKET_ORDER.map((key) => [key, { key, label: BUCKET_LABELS[key], planned: 0, recorded: 0, count: 0 }]),
      )
      let planned = 0
      let recorded = 0
      let savings = 0

      month.savingsEvents.forEach((event) => {
        const bucket = buckets.get('savings')!
        bucket.planned += event.amount
        bucket.count += 1
        savings += event.amount
      })

      month.events.filter((event) => event.kind === 'expense').forEach((event) => {
        const key = bucketKey(event, flowsById)
        const bucket = buckets.get(key)!
        bucket.planned += event.amount
        bucket.recorded += event.actualAmount ?? 0
        bucket.count += 1
        planned += event.amount
        recorded += event.actualAmount ?? 0
      })

      const moneyIn = month.income + month.loanInflows
      return {
        month,
        moneyIn,
        planned,
        recorded,
        opening: month.openingBalance,
        closing: month.closingBalance,
        savings,
        spendable: month.spendableBalance,
        buckets: BUCKET_ORDER.map((key) => buckets.get(key)!).filter((bucket) => bucket.planned > 0),
      }
    }),
    [simulation.months, flowsById],
  )

  const current = rows[0]
  const extraNeeded = Math.max(0, -simulation.lowestSpendable)
  const available = Math.max(0, simulation.endingSpendable)
  const shortMonths = rows.filter((row) => row.spendable < 0)
  const visibleRows = showAll ? rows : rows.slice(0, 6)
  const isShort = Boolean(current && current.spendable < 0)

  return (
    <section className="card funding-card">
      <div className="card-head">
        <div>
          <h2>Funding view</h2>
          <p>Opening balance + planned income − planned spends − savings-fund contributions. Spendable cash is what is free for unplanned things.</p>
        </div>
        <span className={`status-pill ${isShort ? 'pill-red' : 'pill-teal'}`}>
          {isShort ? 'Needs extra funds' : 'Surplus available'}
        </span>
      </div>

      {current && (
        <div className={`funding-hero ${isShort ? 'funding-short' : 'funding-surplus'}`}>
          <div className="funding-hero-main">
            {isShort ? <ArrowDownRight size={22} /> : <ArrowUpRight size={22} />}
            <div>
              <span>{current.month.label}</span>
              <strong>
                {isShort
                  ? `${formatMoney(Math.abs(current.spendable), currency)} extra needed`
                  : `${formatMoney(current.spendable, currency)} free for unplanned spends`}
              </strong>
              <p>
                {formatMoney(current.opening, currency)} carried in + {formatMoney(current.moneyIn, currency)} in
                − {formatMoney(current.planned, currency)} out − {formatMoney(current.savings, currency)} to funds
                = {formatMoney(current.spendable, currency)} spendable
              </p>
            </div>
          </div>
          <div className="funding-hero-stats">
            <div><span>Carried in</span><b>{formatMoney(current.opening, currency)}</b></div>
            <div><span>Planned in</span><b>{formatMoney(current.moneyIn, currency)}</b></div>
            <div><span>Planned out</span><b>{formatMoney(current.planned, currency)}</b></div>
            <div><span>To funds</span><b>{formatMoney(current.savings, currency)}</b></div>
            <div><span>Carried forward</span><b>{formatMoney(current.closing, currency)}</b></div>
            <div><span>Spendable</span><b>{formatMoney(current.spendable, currency)}</b></div>
          </div>
        </div>
      )}

      {current && current.buckets.length > 0 && (
        <div className="funding-buckets">
          {current.buckets.map((bucket) => (
            <div className="funding-bucket" key={bucket.key}>
              <span>{bucket.label}</span>
              <strong>{formatMoney(bucket.planned, currency)}</strong>
              <small>
                {bucket.count} {bucket.count === 1 ? 'entry' : 'entries'}
                {bucket.recorded > 0 ? ` · ${formatMoney(bucket.recorded, currency)} recorded` : ''}
              </small>
            </div>
          ))}
        </div>
      )}

      <div className="funding-table">
        <div className="funding-table-head">
          <span>Month</span>
          <span>Carried in</span>
          <span>Planned in</span>
          <span>Planned out</span>
          <span>To funds</span>
          <span>Carried forward</span>
          <span>Spendable</span>
        </div>
        {visibleRows.map((row) => (
          <div className="funding-table-row" key={row.month.key}>
            <span className="funding-month">{row.month.monthLabel}</span>
            <span>{formatMoney(row.opening, currency)}</span>
            <span>{formatMoney(row.moneyIn, currency)}</span>
            <span>{formatMoney(row.planned, currency)}</span>
            <span>{formatMoney(row.savings, currency)}</span>
            <span>{formatMoney(row.closing, currency)}</span>
            <strong className={row.spendable < 0 ? 'negative' : 'positive'}>{formatSigned(row.spendable, currency)}</strong>
          </div>
        ))}
      </div>

      <div className="funding-footer">
        <div>
          <Wallet size={16} />
          <span>Extra funding needed at worst point</span>
          <strong className="negative">{formatMoney(extraNeeded, currency)}</strong>
          <small>{shortMonths.length} {shortMonths.length === 1 ? 'month' : 'months'} short on spendable cash</small>
        </div>
        <div>
          <span>Spendable money at the end</span>
          <strong className="positive">{formatMoney(available, currency)}</strong>
          <small>after all planned fund contributions</small>
        </div>
        {rows.length > 6 && (
          <button className="link-button" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show less' : `Show all ${rows.length} months`}
            {showAll ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
      </div>
    </section>
  )
}
