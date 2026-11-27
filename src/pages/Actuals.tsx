import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Plus, Search, Trash2, Upload } from 'lucide-react'
import CategoryBadge from '../components/CategoryBadge'
import Modal from '../components/Modal'
import { actualFromEvent, parseActualCsv } from '../lib/actuals'
import { categoryIconKey } from '../lib/categories'
import { isSmsImport } from '../lib/data'
import { formatDate, formatMoney } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, FlowEvent, Simulation } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  currency: string
  onNotify: (message: string) => void
}

type Filter = 'all' | 'income' | 'expense' | 'sms'
type Sort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'name-asc'

export default function Actuals({ data, actions, simulation, currency, onNotify }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<Sort>('date-desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const events = useMemo(() => simulation.months.flatMap((month) => month.events), [simulation.months])
  const recordedKeys = useMemo(() => new Set(data.actuals.map((actual) => actual.event_key)), [data.actuals])
  const today = toDateInputValue()
  const pending = useMemo(
    () => events
      .filter((event) => !recordedKeys.has(event.id) && event.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [events, recordedKeys, today],
  )

  const categoryLabel = (actual: { category?: string; kind: string }): string => (
    actual.category || (actual.kind === 'income' ? 'Income' : 'Other')
  )

  const categoryOptions = useMemo(() => {
    const names = new Set<string>()
    for (const category of data.categories ?? []) names.add(category.name)
    for (const actual of data.actuals ?? []) names.add(categoryLabel(actual))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [data.categories, data.actuals])

  const expenseCategoryOptions = useMemo(() => {
    const names = new Set<string>(['Other'])
    for (const category of data.categories ?? []) {
      if (category.kind === 'expense') names.add(category.name)
    }
    for (const budget of data.budgets ?? []) names.add(budget.category)
    for (const actual of data.actuals ?? []) {
      if (actual.kind === 'expense' && actual.category) names.add(actual.category)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [data.categories, data.budgets, data.actuals])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = data.actuals
      .filter((actual) => filter === 'all' || (filter === 'sms' ? isSmsImport(actual) : actual.kind === filter))
      .filter((actual) => categoryFilter === 'all' || categoryLabel(actual) === categoryFilter)
      .filter((actual) => `${actual.name} ${actual.category} ${actual.note}`.toLowerCase().includes(query))
    return list.sort((a, b) => {
      const dateDesc = b.date.localeCompare(a.date) || b.name.localeCompare(a.name)
      switch (sortBy) {
        case 'date-asc': return a.date.localeCompare(b.date) || a.name.localeCompare(b.name)
        case 'amount-desc': return b.amount - a.amount || dateDesc
        case 'amount-asc': return a.amount - b.amount || dateDesc
        case 'name-asc': return a.name.localeCompare(b.name) || dateDesc
        default: return dateDesc
      }
    })
  }, [data.actuals, filter, categoryFilter, search, sortBy])

  const expenseRows = rows.filter((actual) => actual.kind === 'expense')
  const selectedExpenses = data.actuals.filter(
    (actual) => selectedIds.has(actual.id) && actual.kind === 'expense',
  )
  const allExpensesSelected = expenseRows.length > 0
    && expenseRows.every((actual) => selectedIds.has(actual.id))

  const smsCount = data.actuals.filter(isSmsImport).length
  const incomeTotal = data.actuals.filter((actual) => actual.kind === 'income').reduce((sum, actual) => sum + actual.amount, 0)
  const expenseTotal = data.actuals.filter((actual) => actual.kind === 'expense').reduce((sum, actual) => sum + actual.amount, 0)

  function openAdd() {
    const first = pending[0]
    setSelectedId(first?.id ?? '')
    setAmount(first ? String(Math.round((first.actualAmount ?? first.amount) * 100) / 100) : '')
    setNote('')
    setModal(true)
  }

  async function save() {
    const event = events.find((item) => item.id === selectedId)
    const value = Number(amount)
    if (!event) {
      onNotify('Choose a planned occurrence first.')
      return
    }
    if (event.date > toDateInputValue()) {
      onNotify('Record actual amounts only on or after the planned date.')
      return
    }
    if (!Number.isFinite(value) || value < 0) {
      onNotify('Enter a valid actual amount.')
      return
    }
    try {
      setBusy(true)
      await actions.upsertActual({ ...actualFromEvent(event, note.trim()), amount: Math.round(value * 100) / 100 })
      onNotify('Actual recorded.')
      setModal(false)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not record this actual.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove the recorded amount for "${name}"?`)) return
    try {
      await actions.deleteActual(id)
      onNotify('Actual removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this actual.')
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllExpenses() {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const actual of expenseRows) {
        if (allExpensesSelected) next.delete(actual.id)
        else next.add(actual.id)
      }
      return next
    })
  }

  async function applyBulkCategory() {
    if (!bulkCategory || !selectedExpenses.length || busy) return
    try {
      setBusy(true)
      for (const actual of selectedExpenses) {
        await actions.upsertActual({ ...actual, category: bulkCategory })
      }
      onNotify(`Category updated for ${selectedExpenses.length} recorded expense${selectedExpenses.length === 1 ? '' : 's'}.`)
      setSelectedIds(new Set())
      setBulkCategory('')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not update these expenses.')
    } finally {
      setBusy(false)
    }
  }

  async function bulkDelete() {
    if (!selectedExpenses.length || busy) return
    if (!window.confirm(`Delete ${selectedExpenses.length} selected recorded expense${selectedExpenses.length === 1 ? '' : 's'}?`)) return
    try {
      setBusy(true)
      for (const actual of selectedExpenses) await actions.deleteActual(actual.id)
      onNotify(`${selectedExpenses.length} recorded expense${selectedExpenses.length === 1 ? '' : 's'} deleted.`)
      setSelectedIds(new Set())
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not delete these expenses.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveSms() {
    if (!window.confirm(`Remove all ${smsCount} SMS-imported actuals? Manual entries stay untouched.`)) return
    try {
      await actions.deleteSmsImports()
      setFilter('all')
      onNotify('SMS imports removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove SMS imports.')
    }
  }

  async function importCsv(file: File) {
    try {
      setBusy(true)
      const text = await file.text()
      const { rows, unmatched } = parseActualCsv(text, simulation.months)
      for (const row of rows) await actions.upsertActual(row)
      onNotify(unmatched.length
        ? `${rows.length} actuals imported · ${unmatched.length} row(s) did not match a planned entry.`
        : `${rows.length} actuals imported.`)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not import this CSV.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Track</span>
          <h1>Recorded spends</h1>
          <p>Record what really happened for each planned occurrence and compare it with your forecast.</p>
        </div>
        <div className="header-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importCsv(file)
            }}
          />
          <button className="btn btn-outline" disabled={busy || !events.length} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-primary" disabled={!pending.length} onClick={openAdd}><Plus size={16} /> Record spend</button>
        </div>
      </header>

      <div className="stat-strip">
        <div><span>Recorded entries</span><strong>{data.actuals.length}</strong></div>
        <div><span>Actual income</span><strong className="positive">{formatMoney(incomeTotal, currency)}</strong></div>
        <div><span>Actual spend</span><strong className="negative">−{formatMoney(expenseTotal, currency)}</strong></div>
        <div><span>Still to record</span><strong>{pending.length}</strong></div>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Recorded amounts</h2>
            <p>CSV format: <code>date,name,amount</code>. Rows match a planned occurrence by date, or by month for monthly budgets.</p>
          </div>
          <span className="status-pill pill-blue"><FileSpreadsheet size={14} /> date, name, amount</span>
        </div>
        <div className="toolbar">
          <div className="filter-tabs">
            {(['all', 'income', 'expense', 'sms'] as Filter[]).map((option) => (
              <button
                key={option}
                className={filter === option ? 'filter-active' : ''}
                onClick={() => { setFilter(option); setSelectedIds(new Set()) }}
              >
                {option === 'all' ? 'All' : option === 'income' ? 'Income' : option === 'expense' ? 'Expenses' : `SMS (${smsCount})`}
              </button>
            ))}
          </div>
          <label className="toolbar-select" title="Select all visible expenses">
            <input
              type="checkbox"
              checked={allExpensesSelected}
              disabled={!expenseRows.length}
              onChange={toggleAllExpenses}
            />
            <span>Select all</span>
          </label>
          <label className="toolbar-select">
            <span>Category</span>
            <select
              value={categoryFilter}
              onChange={(event) => { setCategoryFilter(event.target.value); setSelectedIds(new Set()) }}
            >
              <option value="all">All</option>
              {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="toolbar-select">
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as Sort)}>
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="amount-desc">Amount: high to low</option>
              <option value="amount-asc">Amount: low to high</option>
              <option value="name-asc">Name A–Z</option>
            </select>
          </label>
          <div className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setSelectedIds(new Set()) }}
              placeholder="Search actuals…"
            />
          </div>
          {smsCount > 0 && (
            <button className="btn btn-danger btn-small" onClick={() => void handleRemoveSms()}>
              <Trash2 size={14} /> Remove SMS imports
            </button>
          )}
        </div>

        {selectedExpenses.length > 0 && (
          <div className="bulk-bar">
            <span>{selectedExpenses.length} expense{selectedExpenses.length === 1 ? '' : 's'} selected</span>
            <select
              aria-label="New category for selected expenses"
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
            >
              <option value="">Change category…</option>
              {expenseCategoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button
              className="btn btn-outline btn-small"
              disabled={!bulkCategory || busy}
              onClick={() => void applyBulkCategory()}
            >
              Apply category
            </button>
            <button className="btn btn-danger btn-small" disabled={busy} onClick={() => void bulkDelete()}>
              <Trash2 size={14} /> Delete selected
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => setSelectedIds(new Set())}>Clear</button>
          </div>
        )}

        {rows.length ? (
          <div className="actual-list">
            {rows.map((actual) => (
              <div className={`actual-row ${selectedIds.has(actual.id) ? 'actual-row-selected' : ''}`} key={actual.id}>
                {actual.kind === 'expense' ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${actual.name}`}
                    checked={selectedIds.has(actual.id)}
                    onChange={() => toggleSelect(actual.id)}
                  />
                ) : <span />}
                <CategoryBadge
                  name={categoryLabel(actual)}
                  icon={categoryIconKey(data.categories, categoryLabel(actual), actual.kind)}
                  small
                />
                <div className="actual-main">
                  <strong>{actual.name}{isSmsImport(actual) && <span className="mini-tag" title="Imported from SMS">SMS</span>}</strong>
                  <span>{formatDate(actual.date)} · {categoryLabel(actual)}{actual.note ? ` · ${actual.note}` : ''}</span>
                </div>
                <strong className={actual.kind === 'income' ? 'positive' : ''}>
                  {actual.kind === 'income' ? '+' : '−'}{formatMoney(actual.amount, currency)}
                </strong>
                <button className="icon-button danger" title="Delete actual" onClick={() => void remove(actual.id, actual.name)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <CheckCircle2 size={30} />
            <strong>No actuals here</strong>
            <span>Record an amount from the calendar or add one here to compare it with the plan.</span>
            <button className="btn btn-primary btn-small" disabled={!pending.length} onClick={openAdd}>Record spend</button>
          </div>
        )}
      </section>

      {modal && (
        <Modal
          title="Record an actual amount"
          subtitle="Pick a planned occurrence and enter the amount that really happened."
          onClose={() => setModal(false)}
        >
          <div className="form-stack">
            <label className="field">
              <span>Planned occurrence</span>
              <select value={selectedId} onChange={(event) => {
                const next = events.find((item) => item.id === event.target.value) as FlowEvent | undefined
                setSelectedId(event.target.value)
                setAmount(next ? String(Math.round((next.actualAmount ?? next.amount) * 100) / 100) : '')
              }}>
                {pending.map((event) => (
                  <option key={event.id} value={event.id}>
                    {formatDate(event.date)} · {event.name} · {formatMoney(event.amount, currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Actual amount ({currency})</span>
              <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. bank statement" />
            </label>
          </div>
          <div className="dialog-actions">
            <button className="btn btn-outline btn-small" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>Save actual</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
