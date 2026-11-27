import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import { formatMoney, formatSigned } from '../lib/format'
import type { AppActions, AppData, FlowEvent, MonthProjection } from '../lib/types'

interface Props {
  data: AppData
  months: MonthProjection[]
  selectedKey: string
  onSelect: (key: string) => void
  currency: string
  actions: AppActions
  onNotify: (message: string) => void
  onAddIncome: () => void
  onAddExpense: () => void
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function MonthPreview({
  data,
  months,
  selectedKey,
  onSelect,
  currency,
  actions,
  onNotify,
  onAddIncome,
  onAddExpense,
}: Props) {
  const foundIndex = months.findIndex((candidate) => candidate.key === selectedKey)
  const index = foundIndex < 0 ? 0 : foundIndex
  const month = months[index]
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditingId(null)
    setDraft('')
  }, [selectedKey])

  if (!month) return null

  const incomeEntry = data.monthlyIncomes.find((entry) => entry.month === month.key)
  const hasEarlierIncome =
    data.monthlyIncomes.some((entry) => entry.month < month.key) || data.profile.monthly_income > 0

  function moveMonth(delta: number) {
    const next = months[index + delta]
    if (next) onSelect(next.key)
  }

  function findOverride(event: FlowEvent) {
    if (!event.cashFlowId) return undefined
    const sourceMonth = event.sourceMonth ?? month.key
    return data.cashFlowOverrides.find(
      (override) => override.cash_flow_id === event.cashFlowId && override.month === sourceMonth,
    )
  }

  function customAmount(event: FlowEvent): number {
    return data.cashFlows.find((flow) => flow.id === event.cashFlowId)?.amount ?? event.amount
  }

  async function saveAmount(event: FlowEvent) {
    const amount = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      onNotify('Enter a valid amount of zero or more.')
      return
    }
    try {
      if (event.source === 'profile') {
        const day = Number(event.date.slice(-2)) || 1
        await actions.upsertMonthlyIncome({
          month: month.key,
          amount,
          day,
          note: data.monthlyIncomes.find((entry) => entry.month === month.key)?.note ?? '',
        })
        onNotify('Expected income set for this month.')
      } else {
        if (!event.cashFlowId) return
        await actions.upsertCashFlowOverride({
          cash_flow_id: event.cashFlowId,
          month: month.key,
          amount,
        })
        onNotify('Amount fixed for this month.')
      }
      setEditingId(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this amount.')
    }
  }

  async function useCustom(event: FlowEvent) {
    try {
      if (event.source === 'profile') {
        if (!incomeEntry) return
        await actions.deleteMonthlyIncome(incomeEntry.id)
        onNotify('This month uses your earlier expected income again.')
      } else {
        const override = findOverride(event)
        if (!override) return
        await actions.deleteCashFlowOverride(override.id)
        onNotify('This month uses the custom amount again.')
      }
      setEditingId(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not reset this amount.')
    }
  }

  const events = [...month.events].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  )
  const incoming = events.filter((event) => event.kind === 'income')
  const outgoing = events.filter((event) => event.kind === 'expense')
  const moneyIn = month.income + month.loanInflows
  const moneyOut = month.expenses + month.loanPayments + month.extraPayment

  function renderEvent(event: FlowEvent) {
    const isLoan = event.source === 'loan' || event.source === 'extra_payment'
    const isIncome = event.source === 'profile'
    const editable = Boolean(event.cashFlowId) || isIncome
    const override = findOverride(event)
    const editing = editable && editingId === event.id
    const canReset = isIncome ? Boolean(incomeEntry) : Boolean(override)

    const detail = editing
      ? isIncome
        ? `Set for ${month.label} only · now ${formatMoney(event.amount, currency)}`
        : `Custom amount ${formatMoney(customAmount(event), currency)}`
      : `${event.category}${isLoan ? ' · Loan' : ''}${isIncome ? (incomeEntry ? ' · Planned this month' : hasEarlierIncome ? ' · Carried forward' : ' · Not set') : ''}${override ? ' · Fixed amount' : ''}`

    return (
      <div className={`preview-row ${editing ? 'preview-row-editing' : ''}`} key={event.id}>
        <span className="preview-date">{shortDate(event.date)}</span>
        <div className="preview-event">
          <strong>{event.name}</strong>
          <span>{detail}</span>
        </div>
        {editing ? (
          <div className="preview-edit">
            <input
              aria-label={`Amount for ${event.name}`}
              type="number"
              min="0"
              step="0.01"
              value={draft}
              onChange={(change) => setDraft(change.target.value)}
            />
            <button className="icon-button" title="Save amount" aria-label="Save amount" onClick={() => saveAmount(event)}><Check size={15} /></button>
            <button className="icon-button" title="Cancel" aria-label="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
            {canReset && (
              <button
                className="btn btn-ghost btn-small"
                title={isIncome ? 'Use earlier expected income' : 'Use custom amount'}
                onClick={() => useCustom(event)}
              >
                <RotateCcw size={13} /> {isIncome ? 'Reset' : 'Custom'}
              </button>
            )}
          </div>
        ) : (
          <>
            <b className={event.kind === 'income' ? 'positive' : ''}>
              {event.kind === 'income' ? '+' : '−'}{formatMoney(event.amount, currency)}
            </b>
            {editable && (
              <button
                className="icon-button preview-edit-button"
                title={isIncome ? "Edit this month's expected income" : "Edit this month's amount"}
                aria-label={`Edit ${event.name} for this month`}
                onClick={() => {
                  setEditingId(event.id)
                  setDraft(String(event.amount))
                }}
              >
                <Pencil size={14} />
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <section className="card month-preview" id="month-preview">
      <div className="card-head">
        <div>
          <h2>Month preview</h2>
          <p>Every planned cash flow on its actual date · edit monthly income or any month's amount inline</p>
        </div>
        <div className="preview-controls">
          <span className={`status-pill ${month.net >= 0 ? 'pill-green' : 'pill-red'}`}>
            {month.net >= 0 ? 'Surplus' : 'Deficit'}
          </span>
          <div className="month-stepper">
            <button className="icon-button" aria-label="Previous month" title="Previous month" onClick={() => moveMonth(-1)} disabled={index <= 0}><ChevronLeft size={15} /></button>
            <button className="icon-button" aria-label="Next month" title="Next month" onClick={() => moveMonth(1)} disabled={index >= months.length - 1}><ChevronRight size={15} /></button>
          </div>
          <label className="month-picker">
            <CalendarDays size={15} />
            <select
              aria-label="Preview month"
              value={month.key}
              onChange={(event) => onSelect(event.target.value)}
            >
              {months.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="preview-stats">
        <div><span>Money in</span><strong className="positive">{formatMoney(moneyIn, currency)}</strong></div>
        <div><span>Planned spends</span><strong>{formatMoney(month.expenses, currency)}</strong></div>
        <div><span>Loan payments</span><strong>{formatMoney(month.loanPayments + month.extraPayment, currency)}</strong></div>
        <div><span>Needed / free</span><strong className={month.net >= 0 ? 'positive' : 'negative'}>{formatSigned(month.net, currency)}</strong></div>
        <div><span>Closing balance</span><strong>{formatMoney(month.closingBalance, currency)}</strong></div>
      </div>

      <div className="preview-columns">
        <div className="preview-column">
          <div className="preview-column-head">
            <span className="mini-subhead">Money out · {outgoing.length}</span>
            <strong className="negative">−{formatMoney(moneyOut, currency)}</strong>
          </div>
          {outgoing.length
            ? outgoing.map(renderEvent)
            : <p className="preview-empty">Nothing scheduled to pay this month.</p>}
        </div>
        <div className="preview-column">
          <div className="preview-column-head">
            <span className="mini-subhead">Money in · {incoming.length}</span>
            <strong className="positive">+{formatMoney(moneyIn, currency)}</strong>
          </div>
          {incoming.map(renderEvent)}
        </div>
      </div>

      <div className="preview-footer">
        <span>Balance at month end: <strong>{formatMoney(month.closingBalance, currency)}</strong></span>
        <div className="preview-footer-actions">
          <button className="btn btn-outline btn-small" onClick={onAddIncome}><Plus size={14} /> Add income</button>
          <button className="btn btn-outline btn-small" onClick={onAddExpense}><Plus size={14} /> Add planned spend</button>
        </div>
      </div>
    </section>
  )
}
