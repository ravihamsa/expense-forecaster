import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Check,
  Cloud,
  Download,
  FileJson,
  HardDrive,
  Save,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import Modal from '../components/Modal'
import {
  buildDataExport,
  exportLocalDemoData,
  listLocalDemoAccounts,
  parseDataExport,
  usingSupabase,
} from '../lib/data'
import type { AuthUser, ProfilePatch } from '../lib/data'
import { currencySymbol, formatMoney } from '../lib/format'
import type { AppActions, AppData, DataExport } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  user: AuthUser
  onNotify: (message: string) => void
}

const CURRENCIES = [
  { value: 'INR', label: 'INR — Indian Rupee (₹)' },
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
]

function downloadJson(filename: string, payload: DataExport): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportCounts(payload: DataExport): { label: string; value: number }[] {
  const source = payload.data
  return [
    { label: 'Cash flows', value: source.cashFlows.length },
    { label: 'Income plans', value: source.monthlyIncomes.length },
    { label: 'Budgets', value: source.budgets.length },
    { label: 'Goals', value: source.goals.length },
    { label: 'Actuals', value: source.actuals.length },
    { label: 'Loans', value: source.loans.length },
    { label: 'Payments', value: source.loanPayments.length },
    {
      label: 'Calendar changes',
      value: source.cashFlowOverrides.length + source.cashFlowMoves.length + source.cashFlowSkips.length,
    },
  ]
}

export default function Settings({ data, actions, user, onNotify }: Props) {
  const [name, setName] = useState(data.profile.display_name)
  const [currency, setCurrency] = useState(data.profile.currency || 'INR')
  const [cashInHand, setCashInHand] = useState(String(data.profile.cash_in_hand))
  const [bankBalance, setBankBalance] = useState(String(data.profile.bank_balance))
  const [horizon, setHorizon] = useState(String(data.profile.horizon_months))
  const [growth, setGrowth] = useState(String(data.profile.income_growth_pct))
  const [inflation, setInflation] = useState(String(data.profile.expense_inflation_pct))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<DataExport | null>(null)
  const [replaceMode, setReplaceMode] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')
  const demoAccounts = useMemo(() => listLocalDemoAccounts().filter((account) => account.hasData), [])

  const startingBalance = (Number(cashInHand) || 0) + (Number(bankBalance) || 0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const cash = Number(cashInHand) || 0
    const bank = Number(bankBalance) || 0
    const patch: ProfilePatch = {
      display_name: name.trim(),
      currency,
      cash_in_hand: cash,
      bank_balance: bank,
      opening_balance: cash + bank,
      horizon_months: Math.max(1, Math.min(36, Number(horizon) || 12)),
      income_growth_pct: Number(growth) || 0,
      expense_inflation_pct: Number(inflation) || 0,
    }
    if (cash < 0 || bank < 0) {
      setError('Cash in hand and bank balance cannot be negative.')
      return
    }
    setBusy(true)
    try {
      await actions.saveProfile(patch)
      onNotify('Settings saved. Forecast updated.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your settings.')
    } finally {
      setBusy(false)
    }
  }

  function downloadCurrent() {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadJson(`finplannar-${stamp}.json`, buildDataExport(user, data))
    onNotify('JSON backup downloaded.')
  }

  function downloadDemo(userId: string) {
    const payload = exportLocalDemoData(userId)
    if (!payload) {
      setImportError('That demo account has no saved data.')
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    downloadJson(`finplannar-demo-${stamp}.json`, payload)
    onNotify('Demo data downloaded as JSON.')
  }

  async function handleFile(file: File) {
    setImportError('')
    setImportSuccess('')
    try {
      const payload = parseDataExport(await file.text())
      setPreview(payload)
      setReplaceMode(false)
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'Could not read that JSON file.')
    }
  }

  async function confirmImport() {
    if (!preview || importBusy) return
    const total = exportCounts(preview).reduce((sum, item) => sum + item.value, 0)
    setImportBusy(true)
    setImportError('')
    try {
      await actions.importData(preview, replaceMode)
      setPreview(null)
      setImportSuccess(`Imported ${total} ${total === 1 ? 'entry' : 'entries'} into this account.`)
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'Could not import that data.')
    } finally {
      setImportBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const counts = preview ? exportCounts(preview) : []
  const total = counts.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Preferences</span>
          <h1>Settings</h1>
          <p>Set your starting cash and the assumptions behind your forecast.</p>
        </div>
      </header>

      <div className="settings-grid">
        <form className="card form-card" onSubmit={handleSubmit}>
          <div className="card-head">
            <div>
              <h2><Settings2 size={18} /> Your profile</h2>
              <p>Shown on your dashboard and used across all calculations.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field field-span-2">
              <span>Display name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </label>
            <label className="field field-span-2">
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <div className="field-hint-card">
            <span>Expected income can change every month, so you set it on the dashboard's <strong>Month preview</strong>. It is no longer a global setting.</span>
          </div>

          <div className="section-divider" />
          <h3 className="subhead">Where you're starting from</h3>
          <div className="form-grid">
            <label className="field">
              <span>Cash in hand ({currencySymbol(currency)})</span>
              <input type="number" min="0" step="0.01" value={cashInHand} onChange={(e) => setCashInHand(e.target.value)} />
            </label>
            <label className="field">
              <span>Bank balance ({currencySymbol(currency)})</span>
              <input type="number" min="0" step="0.01" value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} />
            </label>
            <div className="starting-balance field-span-2">
              <span>Starting point for your plan</span>
              <strong>{formatMoney(startingBalance, currency)}</strong>
            </div>
          </div>
          <p className="helper-text">Your forecast begins with cash in hand plus your bank balance. Update them whenever you want to re-plan from a new starting point.</p>

          <div className="section-divider" />
          <h3 className="subhead">Forecast assumptions</h3>
          <div className="form-grid">
            <label className="field">
              <span>Forecast months</span>
              <input type="number" min="1" max="36" value={horizon} onChange={(e) => setHorizon(e.target.value)} required />
            </label>
            <label className="field">
              <span>Annual income growth (%)</span>
              <input type="number" min="-50" max="100" step="0.1" value={growth} onChange={(e) => setGrowth(e.target.value)} />
            </label>
            <label className="field field-span-2">
              <span>Annual expense inflation (%)</span>
              <input type="number" min="-50" max="100" step="0.1" value={inflation} onChange={(e) => setInflation(e.target.value)} />
            </label>
          </div>
          <p className="helper-text">Growth and inflation are optional. Set both to 0 for a flat, simple forecast.</p>

          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy}><Save size={16} /> {busy ? 'Saving…' : 'Save settings'}</button>
        </form>

        <div className="settings-aside">
          <section className="card info-card">
            <div className="card-head">
              <div>
                <h2>Where your data lives</h2>
              </div>
            </div>
            <div className="mode-callout">
              {usingSupabase ? <Cloud size={22} /> : <HardDrive size={22} />}
              <div>
                <strong>{usingSupabase ? 'Supabase connected' : 'Local demo mode'}</strong>
                <p>
                  {usingSupabase
                    ? 'Accounts, cash flows and loans are stored in your Supabase project with row-level security.'
                    : 'No Supabase keys found, so entries are stored in this browser. Add your project URL and anon key in .env.local to enable cloud sync and real accounts.'}
                </p>
              </div>
            </div>
            <div className="security-note"><ShieldCheck size={16} /> Passwords are never stored in plain text.</div>
          </section>

          <section className="card info-card">
            <div className="card-head"><div><h2>How forecasting works</h2></div></div>
            <ul className="bullet-list">
              <li>Your plan starts from cash in hand plus bank balance, then adds each month's projected net.</li>
              <li>Recurring items repeat from their start date; one-time items appear only in their chosen month.</li>
              <li>Loan EMIs are deducted monthly and interest is recalculated on the outstanding balance.</li>
              <li>One-time loans (including money you lent) can have several lump-sum payments on different dates; repayments received count as income.</li>
              <li>A month is a deficit when its net cash flow is negative, even if your overall balance stays positive.</li>
              <li>Use the Balance plan to trim flexible spending or prepay loans and compare outcomes.</li>
            </ul>
          </section>
        </div>
      </div>

      <section className="card migration-card">
        <div className="card-head">
          <div>
            <h2><FileJson size={18} /> Move your data</h2>
            <p>Download a portable JSON copy, or bring one into this account. Owner, ids and references are remapped automatically.</p>
          </div>
          <span className={`status-pill ${usingSupabase ? 'pill-blue' : 'pill-teal'}`}>
            {usingSupabase ? 'Import into Supabase' : 'Local demo backup'}
          </span>
        </div>

        <div className="migration-grid">
          <div className="migration-action">
            <strong>Download JSON</strong>
            <span>Save everything currently loaded as a backup you can import anywhere.</span>
            <button className="btn btn-outline" onClick={downloadCurrent}><Download size={16} /> Download JSON</button>
          </div>
          <div className="migration-action">
            <strong>Import JSON</strong>
            <span>Load a FinPlannar export, preview its contents, then merge or replace.</span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import JSON</button>
          </div>
        </div>

        {importError && <div className="alert alert-error">{importError}</div>}
        {importSuccess && <div className="alert alert-success"><Check size={15} /> {importSuccess}</div>}

        {demoAccounts.length > 0 && (
          <div className="demo-export-list">
            <strong>Demo data still in this browser</strong>
            <p>
              {usingSupabase
                ? 'Download an older demo account here, then import the file above into your Supabase account.'
                : 'These local demo accounts can be saved as JSON before you move to Supabase.'}
            </p>
            <div className="demo-export-rows">
              {demoAccounts.map((account) => (
                <div className="demo-export-row" key={account.id}>
                  <div>
                    <strong>{account.name}</strong>
                    <span>{account.email}</span>
                  </div>
                  <button className="btn btn-outline btn-small" onClick={() => downloadDemo(account.id)}>
                    <Download size={14} /> Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="helper-text">
          Profile settings are always updated from the file. <strong>Merge</strong> keeps existing entries and adds new ones;
          <strong> replace</strong> removes all existing entries first and cannot be undone.
        </p>
      </section>

      {preview && (
        <Modal
          title="Import JSON data"
          subtitle={`Exported ${new Date(preview.exportedAt).toLocaleString()} from ${preview.account.display_name || 'another account'}`}
          onClose={() => setPreview(null)}
        >
          <div className="import-preview">
            <div className="import-preview-meta">
              <span><strong>Source</strong>{preview.source.mode === 'supabase' ? 'Supabase export' : 'Local demo export'}</span>
              <span><strong>Account</strong>{preview.account.email || preview.account.display_name || 'Unknown'}</span>
            </div>

            <div className="import-preview-stats">
              {counts.map((item) => (
                <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
              ))}
            </div>
            <p className="helper-text">{total} entries will be imported with fresh ids.</p>

            <div className="import-choice-group" role="radiogroup" aria-label="Import mode">
              <button
                type="button"
                role="radio"
                aria-checked={!replaceMode}
                className={`import-choice ${replaceMode ? '' : 'import-choice-active'}`}
                onClick={() => setReplaceMode(false)}
              >
                <strong>Merge with existing</strong>
                <span>Keep what is in this account and add the imported entries.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={replaceMode}
                className={`import-choice ${replaceMode ? 'import-choice-active import-choice-danger' : ''}`}
                onClick={() => setReplaceMode(true)}
              >
                <strong>Replace everything</strong>
                <span>Delete all existing entries first. This cannot be undone.</span>
              </button>
            </div>

            {importError && <div className="alert alert-error">{importError}</div>}

            <div className="dialog-actions">
              <button className="btn btn-outline btn-small" onClick={() => setPreview(null)}>Cancel</button>
              <button
                className={`btn btn-small ${replaceMode ? 'btn-danger' : 'btn-primary'}`}
                disabled={importBusy}
                onClick={() => void confirmImport()}
              >
                <Upload size={14} /> {importBusy ? 'Importing…' : 'Import data'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
