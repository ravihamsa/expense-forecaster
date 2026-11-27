import { useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  CalendarDays,
  PiggyBank,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import Modal from '../components/Modal'
import CashFlowForm from '../components/CashFlowForm'
import { isSmsImport } from '../lib/data'
import { goalFundAccountId } from '../lib/goals'
import { formatDate, formatMoney } from '../lib/format'
import { nextOccurrence, recurrenceLabel, toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, CashFlow, FlowKind, NewCashFlow } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  onNotify: (message: string) => void
}

type Filter = 'all' | 'income'

function monthlyValue(flow: CashFlow): number {
  switch (flow.recurrence) {
    case 'monthly': return flow.amount
    case 'yearly': return flow.amount / 12
    case 'every_n_months': return flow.amount / Math.max(1, flow.interval_count)
    case 'every_n_years': return flow.amount / (12 * Math.max(1, flow.interval_count))
    default: return 0
  }
}

export default function CashFlows({ data, actions, onNotify }: Props) {
  const currency = data.profile.currency || 'INR'
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; flow?: CashFlow; kind?: FlowKind } | null>(null)

  const incomeFlows = useMemo(() => data.cashFlows.filter((flow) => flow.kind === 'income'), [data.cashFlows])
  const flows = useMemo(() => {
    return incomeFlows
      .filter((flow) => filter === 'all' || flow.kind === filter)
      .filter((flow) => `${flow.name} ${flow.category} ${flow.note}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (nextOccurrence(b)?.getTime() ?? 0) - (nextOccurrence(a)?.getTime() ?? 0))
  }, [incomeFlows, filter, search])

  const monthlyIncome = incomeFlows.reduce((sum, flow) => sum + monthlyValue(flow), 0)
  const monthlySavings = (data.goals ?? []).reduce((sum, goal) => sum + Math.max(0, goal.monthly_contribution), 0)
  const scheduledCount = incomeFlows.filter((flow) => {
    const next = nextOccurrence(flow)
    return next !== null && flow.recurrence !== 'monthly'
  }).length

  async function handleSave(input: NewCashFlow) {
    if (modal?.mode === 'edit' && modal.flow) {
      await actions.updateCashFlow(modal.flow.id, input)
      onNotify('Cash flow updated.')
    } else {
      await actions.addCashFlow(input)
      onNotify('Cash flow added.')
    }
    setModal(null)
  }

  async function handleDelete(flow: CashFlow) {
    if (!window.confirm(`Delete "${flow.name}"? This cannot be undone.`)) return
    try {
      await actions.deleteCashFlow(flow.id)
      onNotify('Cash flow deleted.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not delete this entry.')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Money in</span>
          <h1>Cash flow</h1>
          <p>Income and savings-fund transfers. Planned spends live on the Planned spends page and appear in Month preview and the forecast.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', kind: 'income' })}><Plus size={16} /> Add income</button>
        </div>
      </header>

      <section className="stat-strip">
        <div><span>Recurring income / mo</span><strong className="positive">{formatMoney(monthlyIncome, currency)}</strong></div>
        <div><span>To savings funds / mo</span><strong>{formatMoney(monthlySavings, currency)}</strong></div>
        <div><span>Scheduled income plans</span><strong>{scheduledCount}</strong></div>
        <div><span>Income entries</span><strong>{incomeFlows.length}</strong></div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Savings funds</h2>
            <p>Planned contributions move into the fund. They reduce spendable cash, not your net worth.</p>
          </div>
        </div>
        {(data.goals ?? []).length ? (
          <div className="flow-list">
            {(data.goals ?? []).map((goal) => {
              const destination = goalFundAccountId(goal, data.accounts ?? [])
              const destinationName = data.accounts?.find((account) => account.id === destination)?.name ?? goal.name
              return (
                <div className="flow-row" key={goal.id}>
                  <span className="flow-icon"><PiggyBank size={18} /></span>
                  <div className="flow-main">
                    <strong>{goal.name}</strong>
                    <span>Planned transfer into {destinationName} · {formatMoney(goal.current_amount, currency)} of {formatMoney(goal.target_amount, currency)} saved</span>
                  </div>
                  <strong className="flow-amount">−{formatMoney(goal.monthly_contribution, currency)} / mo</strong>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="preview-empty">No savings funds yet. Add one on the Savings funds page to see its monthly contribution here.</p>
        )}
      </section>

      <section className="card">
        <div className="toolbar">
          <div className="filter-tabs">
            {(['all', 'income'] as Filter[]).map((option) => (
              <button key={option} className={filter === option ? 'filter-active' : ''} onClick={() => setFilter(option)}>
                {option === 'all' ? 'All income' : 'Income'}
              </button>
            ))}
          </div>
          <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search income…" /></div>
        </div>

        {flows.length ? (
          <div className="flow-list">
            {flows.map((flow) => {
              const next = nextOccurrence(flow)
              return (
                <div className="flow-row" key={flow.id}>
                  <span className="flow-icon income"><ArrowDownLeft size={18} /></span>
                  <div className="flow-main">
                    <strong>{flow.name}{isSmsImport(flow) && <span className="mini-tag" title="Imported from SMS">SMS</span>}</strong>
                    <span>{flow.category} · {recurrenceLabel(flow)}{flow.interval_count > 1 && (flow.recurrence === 'every_n_months' || flow.recurrence === 'every_n_years') ? ` (${flow.interval_count})` : ''}</span>
                  </div>
                  <div className="flow-date"><CalendarDays size={14} /> {next ? formatDate(toDateInputValue(next)) : 'Ended'}</div>
                  <strong className={`flow-amount ${flow.kind === 'income' ? 'positive' : ''}`}>
                    {flow.kind === 'income' ? '+' : '−'}{formatMoney(flow.amount, currency)}
                  </strong>
                  <div className="row-actions">
                    <button className="icon-button" title="Edit" onClick={() => setModal({ mode: 'edit', flow })}><Pencil size={16} /></button>
                    <button className="icon-button danger" title="Delete" onClick={() => handleDelete(flow)}><Trash2 size={16} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <CalendarDays size={30} />
            <strong>No income entries here yet</strong>
            <span>Add recurring or one-off income to include it in the forecast.</span>
            <button className="btn btn-primary btn-small" onClick={() => setModal({ mode: 'add', kind: 'income' })}>Add income</button>
          </div>
        )}
      </section>

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Edit income entry' : 'Add planned income'}
          subtitle="Choose how often income arrives so forecasts stay accurate."
          onClose={() => setModal(null)}
          wide
        >
          <CashFlowForm
            initial={modal.flow}
            defaultKind={modal.kind}
            accounts={data.accounts}
            categories={data.categories}
            currency={currency}
            onCancel={() => setModal(null)}
            onSave={handleSave}
          />
        </Modal>
      )}
    </div>
  )
}
