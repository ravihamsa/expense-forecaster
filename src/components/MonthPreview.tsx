import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import CategoryBadge from './CategoryBadge'
import { categoryColor } from './CategoryBadge'
import { formatMoney, formatSigned } from '../lib/format'
import { accountLabel } from '../lib/ledger'
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
  const [expandedOutGroups, setExpandedOutGroups] = useState<Set<string>>(new Set())
  const [collapsedInGroups, setCollapsedInGroups] = useState<Set<string>>(new Set())

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
  const moneyOut = month.expenses + month.loanPayments
  const monthlyFree = month.net - month.savingsContributions

  function groupEvents(items: FlowEvent[], kind: 'out' | 'in') {
    const groups = new Map<string, FlowEvent[]>()
    for (const event of items) {
      const label = event.category?.trim() || 'Other'
      const key = `${kind}:${label.toLowerCase()}`
      const list = groups.get(key) ?? []
      list.push(event)
      groups.set(key, list)
    }
    return [...groups.entries()]
      .map(([key, list]) => ({
        key,
        label: list[0]?.category?.trim() || 'Other',
        total: list.reduce((sum, event) => sum + event.amount, 0),
        events: list,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  function toggleGroup(key: string, kind: 'out' | 'in') {
    const update = (current: Set<string>): Set<string> => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    }
    if (kind === 'out') setExpandedOutGroups(update)
    else setCollapsedInGroups(update)
  }

  const outgoingGroups = groupEvents(outgoing, 'out')
  const incomingGroups = groupEvents(incoming, 'in')

  function renderEvent(event: FlowEvent) {
    const isLoan = event.source === 'loan' || event.source === 'extra_payment'
    const isIncome = event.source === 'profile'
    const editable = Boolean(event.cashFlowId) || isIncome
    const override = findOverride(event)
    const editing = editable && editingId === event.id
    const canReset = isIncome ? Boolean(incomeEntry) : Boolean(override)
    const sourceLabel = isLoan
      ? 'Loan'
      : event.source === 'budget'
        ? 'Planned spend'
        : event.source === 'actual'
          ? 'Recorded spend'
          : isIncome
            ? incomeEntry ? 'Planned this month' : hasEarlierIncome ? 'Carried forward' : 'Not set'
            : ''

    const detail = editing
      ? isIncome
        ? `Set for ${month.label} only · now ${formatMoney(event.amount, currency)}`
        : `Custom amount ${formatMoney(customAmount(event), currency)}`
      : [
          event.category,
          sourceLabel,
          override ? 'Fixed amount' : '',
          event.actualAmount !== undefined && event.source !== 'actual' ? 'Actual recorded' : '',
        ].filter(Boolean).join(' · ')

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

  function renderGroup(group: ReturnType<typeof groupEvents>[number], kind: 'out' | 'in') {
    // Expense groups start closed; income groups start open.
    const collapsed = kind === 'out'
      ? !expandedOutGroups.has(group.key)
      : collapsedInGroups.has(group.key)
    return (
      <div
        className="preview-group"
        key={group.key}
        style={{ '--cat-color': categoryColor(group.label) } as CSSProperties}
      >
        <button
          type="button"
          className="preview-group-head"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
          onClick={() => toggleGroup(group.key, kind)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <CategoryBadge name={group.label} small />
          <span className="group-label">{group.label}</span>
          <small>{group.events.length} {group.events.length === 1 ? 'entry' : 'entries'}</small>
          <b className={kind === 'in' ? 'positive' : 'negative'}>
            {kind === 'in' ? '+' : '−'}{formatMoney(group.total, currency)}
          </b>
        </button>
        {!collapsed && (
          <div className="preview-group-items">
            {group.events.map(renderEvent)}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="card month-preview" id="month-preview">
      <div className="card-head">
        <div>
          <h2>Month preview</h2>
          <p>Budgeted spends on their dates · grouped by category · click an expense group to expand · monthly income stays editable</p>
        </div>
        <div className="preview-controls">
          <span className={`status-pill ${month.spendableBalance >= 0 ? 'pill-green' : 'pill-red'}`}>
            {month.spendableBalance >= 0 ? 'Surplus' : 'Deficit'}
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
        <div><span>Opening balance</span><strong>{formatMoney(month.openingBalance, currency)}</strong></div>
        <div><span>Money in</span><strong className="positive">{formatMoney(moneyIn, currency)}</strong></div>
        <div><span>Planned spends</span><strong>{formatMoney(month.expenses, currency)}</strong></div>
        <div><span>Loan payments</span><strong>{formatMoney(month.loanPayments, currency)}</strong></div>
        <div><span>To savings funds</span><strong>{formatMoney(month.savingsContributions, currency)}</strong></div>
        <div><span>Needed / free</span><strong className={monthlyFree >= 0 ? 'positive' : 'negative'}>{formatSigned(monthlyFree, currency)}</strong></div>
        <div><span>Carried forward</span><strong className={month.closingBalance >= 0 ? 'positive' : 'negative'}>{formatMoney(month.closingBalance, currency)}</strong></div>
        <div><span>Spendable balance</span><strong className={month.spendableBalance >= 0 ? 'positive' : 'negative'}>{formatMoney(month.spendableBalance, currency)}</strong></div>
      </div>
      <p className="preview-balance-note">
        Carried forward {formatMoney(month.openingBalance, currency)} + money in {formatMoney(moneyIn, currency)}
        − money out {formatMoney(moneyOut, currency)} = {formatMoney(month.closingBalance, currency)} into next month.
        savings contributions move {formatMoney(month.savingsContributions, currency)} into funds, leaving
        {' '}{formatMoney(month.spendableBalance, currency)} spendable.
      </p>

      {outgoingGroups.length > 0 && moneyOut > 0 && (
        <div className="spend-mix">
          <div className="spend-mix-head">
            <span className="mini-subhead">Money out by category</span>
            <small>{formatMoney(moneyOut, currency)} total</small>
          </div>
          <div className="spend-mix-bar">
            {outgoingGroups.map((group) => (
              <span
                key={group.key}
                style={{
                  width: `${(group.total / moneyOut) * 100}%`,
                  background: categoryColor(group.label),
                }}
                title={`${group.label}: ${formatMoney(group.total, currency)}`}
              />
            ))}
          </div>
          <div className="spend-mix-legend">
            {outgoingGroups.map((group) => (
              <span key={group.key}>
                <i style={{ background: categoryColor(group.label) }} />
                {group.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="preview-columns">
        <div className="preview-column">
          <div className="preview-column-head">
            <span className="mini-subhead">Money out · {outgoing.length}</span>
            <strong className="negative">−{formatMoney(moneyOut, currency)}</strong>
          </div>
          {outgoingGroups.length
            ? outgoingGroups.map((group) => renderGroup(group, 'out'))
            : <p className="preview-empty">No planned spends or recorded spends this month.</p>}
          {month.savingsEvents.length > 0 && (
            <>
              <div className="preview-column-head preview-subhead">
                <span className="mini-subhead">To savings funds · {month.savingsEvents.length}</span>
                <strong className="negative">−{formatMoney(month.savingsContributions, currency)}</strong>
              </div>
              {month.savingsEvents.map((event) => (
                <div className="preview-row" key={event.id}>
                  <span className="preview-date">{shortDate(event.date)}</span>
                  <div className="preview-event">
                    <strong>{event.name}</strong>
                    <span>To {accountLabel(event.to_account, data)} · from {accountLabel(event.from_account, data)}</span>
                  </div>
                  <b className="negative">−{formatMoney(event.amount, currency)}</b>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="preview-column">
          <div className="preview-column-head">
            <span className="mini-subhead">Money in · {incoming.length}</span>
            <strong className="positive">+{formatMoney(moneyIn, currency)}</strong>
          </div>
          {incomingGroups.length
            ? incomingGroups.map((group) => renderGroup(group, 'in'))
            : <p className="preview-empty">No income this month.</p>}
        </div>
      </div>

      <div className="preview-footer">
        <span>Balance at month end: <strong>{formatMoney(month.closingBalance, currency)}</strong> · Spendable: <strong>{formatMoney(month.spendableBalance, currency)}</strong></span>
        <div className="preview-footer-actions">
          <button className="btn btn-outline btn-small" onClick={onAddIncome}><Plus size={14} /> Add income</button>
          <button className="btn btn-outline btn-small" onClick={onAddExpense}><Plus size={14} /> Add planned spend</button>
        </div>
      </div>
    </section>
  )
}
