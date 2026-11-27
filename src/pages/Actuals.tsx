import { useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileSpreadsheet, Plus, Search, Trash2, Upload } from 'lucide-react'
import Modal from '../components/Modal'
import { actualFromEvent, parseActualCsv } from '../lib/actuals'
import { isSmsImport } from '../lib/data'
import { formatDate, formatMoney } from '../lib/format'
import type { AppActions, AppData, FlowEvent, Simulation } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  currency: string
  onNotify: (message: string) => void
}

type Filter = 'all' | 'income' | 'expense' | 'sms'

export default function Actuals({ data, actions, simulation, currency, onNotify }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const events = useMemo(() => simulation.months.flatMap((month) => month.events), [simulation.months])
  const recordedKeys = useMemo(() => new Set(data.actuals.map((actual) => actual.event_key)), [data.actuals])
  const pending = useMemo(
    () => events.filter((event) => !recordedKeys.has(event.id)).sort((a, b) => a.date.localeCompare(b.date)),
    [events, recordedKeys],
  )

  const rows = useMemo(() => data.actuals
    .filter((actual) => filter === 'all' || (filter === 'sms' ? isSmsImport(actual) : actual.kind === filter))
    .filter((actual) => `${actual.name} ${actual.category} ${actual.note}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [data.actuals, filter, search])

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

  async function handleRemoveSms() {
    if (!window.confirm(`Remove all ${smsCount} SMS-imported actuals and their cash flows? Manual entries stay untouched.`)) return
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
          <h1>Planned vs actual</h1>
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
          <button className="btn btn-primary" disabled={!pending.length} onClick={openAdd}><Plus size={16} /> Record actual</button>
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
            <p>CSV format: <code>date,name,amount</code>. Rows must match a planned occurrence on the same date.</p>
          </div>
          <span className="status-pill pill-blue"><FileSpreadsheet size={14} /> date, name, amount</span>
        </div>
        <div className="toolbar">
          <div className="filter-tabs">
            {(['all', 'income', 'expense', 'sms'] as Filter[]).map((option) => (
              <button key={option} className={filter === option ? 'filter-active' : ''} onClick={() => setFilter(option)}>
                {option === 'all' ? 'All' : option === 'income' ? 'Income' : option === 'expense' ? 'Expenses' : `SMS (${smsCount})`}
              </button>
            ))}
          </div>
          <div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actuals…" /></div>
          {smsCount > 0 && (
            <button className="btn btn-danger btn-small" onClick={() => void handleRemoveSms()}>
              <Trash2 size={14} /> Remove SMS imports
            </button>
          )}
        </div>

        {rows.length ? (
          <div className="actual-list">
            {rows.map((actual) => (
              <div className="actual-row" key={actual.id}>
                <span className={`flow-icon ${actual.kind}`}>
                  {actual.kind === 'income' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                </span>
                <div className="actual-main">
                  <strong>{actual.name}{isSmsImport(actual) && <span className="mini-tag" title="Imported from SMS">SMS</span>}</strong>
                  <span>{formatDate(actual.date)} · {actual.category || (actual.kind === 'income' ? 'Income' : 'Other')}{actual.note ? ` · ${actual.note}` : ''}</span>
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
            <button className="btn btn-primary btn-small" disabled={!pending.length} onClick={openAdd}>Record actual</button>
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
