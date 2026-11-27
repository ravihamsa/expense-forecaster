import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Wallet } from 'lucide-react'
import { formatMoney, formatSigned } from '../lib/format'
import type { AppData, FlowEvent, MonthProjection, Simulation } from '../lib/types'

interface Props {
  data: AppData
  simulation: Simulation
  currency: string
}

type BucketKey = 'monthly' | 'yearly' | 'one_time' | 'loans' | 'other'

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
  gap: number
  buckets: Bucket[]
}

const BUCKET_LABELS: Record<BucketKey, string> = {
  monthly: 'Monthly spends',
  yearly: 'Yearly spends',
  one_time: 'One-off spends',
  loans: 'Loan payments',
  other: 'Other recurring',
}

const BUCKET_ORDER: BucketKey[] = ['monthly', 'yearly', 'one_time', 'loans', 'other']

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
        gap: moneyIn - planned,
        buckets: BUCKET_ORDER.map((key) => buckets.get(key)!).filter((bucket) => bucket.planned > 0),
      }
    }),
    [simulation.months, flowsById],
  )

  const current = rows[0]
  const shortfall = rows.reduce((sum, row) => sum + Math.max(0, -row.gap), 0)
  const surplus = rows.reduce((sum, row) => sum + Math.max(0, row.gap), 0)
  const shortMonths = rows.filter((row) => row.gap < 0)
  const visibleRows = showAll ? rows : rows.slice(0, 6)
  const isShort = Boolean(current && current.gap < 0)

  return (
    <section className="card funding-card">
      <div className="card-head">
        <div>
          <h2>Funding view</h2>
          <p>Planned income minus planned spends. The rest is extra money you need, or free money for unplanned things.</p>
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
                  ? `${formatMoney(Math.abs(current.gap), currency)} extra needed`
                  : `${formatMoney(current.gap, currency)} free for unplanned spends`}
              </strong>
              <p>
                {formatMoney(current.moneyIn, currency)} planned in − {formatMoney(current.planned, currency)} planned out
              </p>
            </div>
          </div>
          <div className="funding-hero-stats">
            <div><span>Planned income</span><b>{formatMoney(current.moneyIn, currency)}</b></div>
            <div><span>Planned spends</span><b>{formatMoney(current.planned, currency)}</b></div>
            <div><span>Recorded so far</span><b>{formatMoney(current.recorded, currency)}</b></div>
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
          <span>Planned in</span>
          <span>Planned out</span>
          <span>Needed / free</span>
        </div>
        {visibleRows.map((row) => (
          <div className="funding-table-row" key={row.month.key}>
            <span className="funding-month">{row.month.monthLabel}</span>
            <span>{formatMoney(row.moneyIn, currency)}</span>
            <span>{formatMoney(row.planned, currency)}</span>
            <strong className={row.gap < 0 ? 'negative' : 'positive'}>{formatSigned(row.gap, currency)}</strong>
          </div>
        ))}
      </div>

      <div className="funding-footer">
        <div>
          <Wallet size={16} />
          <span>Extra funding needed ahead</span>
          <strong className="negative">{formatMoney(shortfall, currency)}</strong>
          <small>across {shortMonths.length} {shortMonths.length === 1 ? 'month' : 'months'}</small>
        </div>
        <div>
          <span>Free money available ahead</span>
          <strong className="positive">{formatMoney(surplus, currency)}</strong>
          <small>can be used for unplanned spends</small>
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
