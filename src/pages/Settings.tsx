import { useState, type FormEvent } from 'react'
import { Cloud, HardDrive, Save, Settings2, ShieldCheck } from 'lucide-react'
import { usingSupabase } from '../lib/data'
import type { ProfilePatch } from '../lib/data'
import { currencySymbol, formatMoney } from '../lib/format'
import type { AppActions, AppData } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  onNotify: (message: string) => void
}

const CURRENCIES = [
  { value: 'INR', label: 'INR — Indian Rupee (₹)' },
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
]

export default function Settings({ data, actions, onNotify }: Props) {
  const [name, setName] = useState(data.profile.display_name)
  const [currency, setCurrency] = useState(data.profile.currency || 'INR')
  const [cashInHand, setCashInHand] = useState(String(data.profile.cash_in_hand))
  const [bankBalance, setBankBalance] = useState(String(data.profile.bank_balance))
  const [horizon, setHorizon] = useState(String(data.profile.horizon_months))
  const [growth, setGrowth] = useState(String(data.profile.income_growth_pct))
  const [inflation, setInflation] = useState(String(data.profile.expense_inflation_pct))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    </div>
  )
}
