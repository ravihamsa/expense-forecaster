import { useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import Modal from '../components/Modal'
import CashFlowForm from '../components/CashFlowForm'
import { formatDate, formatMoney } from '../lib/format'
import { nextOccurrence, recurrenceLabel, toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, CashFlow, FlowKind, NewCashFlow } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  onNotify: (message: string) => void
}

type Filter = 'all' | FlowKind

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

  const flows = useMemo(() => {
    return data.cashFlows
      .filter((flow) => filter === 'all' || flow.kind === filter)
      .filter((flow) => `${flow.name} ${flow.category} ${flow.note}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (nextOccurrence(b)?.getTime() ?? 0) - (nextOccurrence(a)?.getTime() ?? 0))
  }, [data.cashFlows, filter, search])

  const monthlyIncome = data.cashFlows.filter((flow) => flow.kind === 'income').reduce((sum, flow) => sum + monthlyValue(flow), 0)
  const monthlyExpense = data.cashFlows.filter((flow) => flow.kind === 'expense').reduce((sum, flow) => sum + monthlyValue(flow), 0)
  const scheduledCount = data.cashFlows.filter((flow) => {
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
          <span className="eyebrow">Plan</span>
          <h1>Cash flow</h1>
          <p>Monthly bills, annual costs, ad-hoc entries and future plans — all in one place.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={() => setModal({ mode: 'add', kind: 'income' })}><Plus size={16} /> Add income</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', kind: 'expense' })}><Plus size={16} /> Add expense</button>
        </div>
      </header>

      <section className="stat-strip">
        <div><span>Recurring income / mo</span><strong className="positive">{formatMoney(monthlyIncome, currency)}</strong></div>
        <div><span>Recurring expenses / mo</span><strong className="negative">−{formatMoney(monthlyExpense, currency)}</strong></div>
        <div><span>Scheduled plans</span><strong>{scheduledCount}</strong></div>
        <div><span>Total entries</span><strong>{data.cashFlows.length}</strong></div>
      </section>

      <section className="card">
        <div className="toolbar">
          <div className="filter-tabs">
            {(['all', 'income', 'expense'] as Filter[]).map((option) => (
              <button key={option} className={filter === option ? 'filter-active' : ''} onClick={() => setFilter(option)}>
                {option === 'all' ? 'All' : option === 'income' ? 'Income' : 'Expenses'}
              </button>
            ))}
          </div>
          <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entries…" /></div>
        </div>

        {flows.length ? (
          <div className="flow-list">
            {flows.map((flow) => {
              const next = nextOccurrence(flow)
              return (
                <div className="flow-row" key={flow.id}>
                  <span className={`flow-icon ${flow.kind}`}>
                    {flow.kind === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                  </span>
                  <div className="flow-main">
                    <strong>{flow.name}</strong>
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
            <strong>No entries here yet</strong>
            <span>Add a recurring bill or a one-time plan to see it in your forecast.</span>
            <button className="btn btn-primary btn-small" onClick={() => setModal({ mode: 'add', kind: 'expense' })}>Add expense</button>
          </div>
        )}
      </section>

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Edit cash flow' : modal.kind === 'income' ? 'Add income' : 'Add expense'}
          subtitle="Choose how often it happens so forecasts stay accurate."
          onClose={() => setModal(null)}
          wide
        >
          <CashFlowForm
            initial={modal.flow}
            defaultKind={modal.kind}
            currency={currency}
            onCancel={() => setModal(null)}
            onSave={handleSave}
          />
        </Modal>
      )}
    </div>
  )
}
