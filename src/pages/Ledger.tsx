import { useMemo, useState } from 'react'
import { ArrowRight, BookOpen, CheckCircle2 } from 'lucide-react'
import { formatMoney, formatSigned } from '../lib/format'
import { accountLabel, buildLedger, summarizeLedger } from '../lib/ledger'
import type { AppData, LedgerEntry } from '../lib/types'

interface Props {
  data: AppData
}

type Filter = 'all' | 'in' | 'out'

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  opening: 'Opening balance',
  income: 'Income received',
  expense: 'Money spent',
  borrowing: 'Money borrowed',
  repayment: 'Loan paid',
  lent: 'Money lent',
  received: 'Money returned',
  transfer: 'Account transfer',
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Ledger({ data }: Props) {
  const currency = data.profile.currency || 'INR'
  const summary = useMemo(() => summarizeLedger(buildLedger(data), data), [data])
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const filtered = summary.rows.filter((row) => {
      if (filter === 'in') return row.cashImpact > 0
      if (filter === 'out') return row.cashImpact < 0
      return true
    })
    return [...filtered].reverse()
  }, [summary.rows, filter])

  const maxDestination = Math.max(1, ...summary.byDestination.map((item) => item.amount))
  const maxSource = Math.max(1, ...summary.bySource.map((item) => item.amount))

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Double-entry trail</span>
          <h1>Money trail</h1>
          <p>Every recorded movement has one source and one destination for the same amount.</p>
        </div>
        <span className="status-pill pill-green"><CheckCircle2 size={14} /> Balanced pairs only</span>
      </header>

      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-icon kpi-blue"><BookOpen size={19} /></div>
          <span className="kpi-label">Opening balance</span>
          <strong className="kpi-value">{formatMoney(summary.openingBalance, currency)}</strong>
          <span className="kpi-foot">Starting balances of all your accounts</span>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon kpi-teal"><ArrowRight size={19} /></div>
          <span className="kpi-label">Money in</span>
          <strong className="kpi-value positive">{formatMoney(summary.totalIn, currency)}</strong>
          <span className="kpi-foot">Income, borrowings and repayments received</span>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon kpi-red"><ArrowRight size={19} /></div>
          <span className="kpi-label">Money out</span>
          <strong className="kpi-value negative">{formatMoney(summary.totalOut, currency)}</strong>
          <span className="kpi-foot">Spending, loan payments and money lent</span>
        </article>
        <article className="kpi-card">
          <div className={`kpi-icon ${summary.net >= 0 ? 'kpi-green' : 'kpi-red'}`}><CheckCircle2 size={19} /></div>
          <span className="kpi-label">Recorded balance</span>
          <strong className={`kpi-value ${summary.net >= 0 ? 'positive' : 'negative'}`}>
            {formatMoney(summary.liquidBalance, currency)}
          </strong>
          <span className="kpi-foot">
            {Object.entries(summary.accountBalances)
              .map(([id, amount]) => `${accountLabel(id, data)} ${formatMoney(amount, currency)}`)
              .join(' · ') || 'No accounts yet'}
          </span>
        </article>
      </section>

      <div className="two-column">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Where money went</h2>
              <p>Destinations of money that left one of your accounts.</p>
            </div>
          </div>
          {summary.byDestination.length ? (
            <div className="breakdown-list">
              {summary.byDestination.map((item) => (
                <div className="breakdown-row" key={item.account}>
                  <div className="breakdown-copy">
                    <strong>{accountLabel(item.account, data)}</strong>
                    <span>{formatMoney(item.amount, currency)}</span>
                  </div>
                  <div className="breakdown-bar">
                    <span style={{ width: `${Math.round((item.amount / maxDestination) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="preview-empty">No money has left your accounts yet.</p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Where money came from</h2>
              <p>Sources of money that reached one of your accounts.</p>
            </div>
          </div>
          {summary.bySource.length ? (
            <div className="breakdown-list">
              {summary.bySource.map((item) => (
                <div className="breakdown-row" key={item.account}>
                  <div className="breakdown-copy">
                    <strong>{accountLabel(item.account, data)}</strong>
                    <span>{formatMoney(item.amount, currency)}</span>
                  </div>
                  <div className="breakdown-bar">
                    <span style={{ width: `${Math.round((item.amount / maxSource) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="preview-empty">No money has reached your accounts yet.</p>
          )}
        </section>
      </div>

      <section className="card ledger-card">
        <div className="card-head">
          <div>
            <h2>Recorded entries</h2>
            <p>Entries dated today or earlier are recorded; later dates stay in the forecast.</p>
          </div>
          <div className="segmented" role="group" aria-label="Ledger filter">
            {(['all', 'in', 'out'] as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                className={filter === option ? 'segment-active' : ''}
                onClick={() => setFilter(option)}
              >
                {option === 'all' ? 'All' : option === 'in' ? 'Money in' : 'Money out'}
              </button>
            ))}
          </div>
        </div>

        {rows.length ? (
          <div className="ledger-list">
            {rows.map((row) => (
              <div className="ledger-row" key={row.id}>
                <div className="ledger-date">{dateLabel(row.date)}</div>
                <div className="ledger-main">
                  <strong>{row.description}</strong>
                  <span>{KIND_LABEL[row.kind]}</span>
                </div>
                <div className="account-pair">
                  <span>{accountLabel(row.from, data)}</span>
                  <ArrowRight size={13} />
                  <span>{accountLabel(row.to, data)}</span>
                </div>
                <b className={row.cashImpact >= 0 ? 'positive' : 'negative'}>
                  {formatSigned(row.cashImpact, currency)}
                </b>
                <div className="ledger-balance">{formatMoney(row.runningBalance, currency)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="preview-empty">No recorded entries for this filter yet.</p>
        )}
      </section>
    </div>
  )
}
