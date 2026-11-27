import { useState } from 'react'
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { formatMoney } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'
import type { Account, AppActions, AppData, NewAccount, NewTransfer, Simulation, Transfer } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  onNotify: (message: string) => void
}

type AccountModal = { mode: 'add' } | { mode: 'edit'; account: Account }

function blankAccount(): NewAccount {
  return { name: '', kind: 'other', opening_balance: 0 }
}

function blankTransfer(accounts: Account[]): NewTransfer {
  return {
    from_account: accounts.find((account) => account.id === 'bank')?.id ?? accounts[0]?.id ?? 'bank',
    to_account: accounts.find((account) => account.kind === 'other')?.id ?? accounts[1]?.id ?? 'cash',
    amount: 0,
    date: toDateInputValue(),
    note: '',
  }
}

function kindLabel(kind: Account['kind']): string {
  if (kind === 'cash') return 'Cash'
  if (kind === 'bank') return 'Bank'
  return 'Custom'
}

export default function Accounts({ data, actions, simulation, onNotify }: Props) {
  const currency = data.profile.currency || 'INR'
  const accounts = data.accounts ?? []
  const transfers = [...(data.transfers ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const [accountModal, setAccountModal] = useState<AccountModal | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [accountForm, setAccountForm] = useState<NewAccount>(blankAccount())
  const [transferForm, setTransferForm] = useState<NewTransfer>(blankTransfer(accounts))
  const [busy, setBusy] = useState(false)

  const totalOpening = accounts.reduce((sum, account) => sum + account.opening_balance, 0)
  const endingTotal = accounts.reduce(
    (sum, account) => sum + (simulation.accountBalances[account.id] ?? 0),
    0,
  )

  const label = (id: string): string => accounts.find((account) => account.id === id)?.name ?? id

  function openAddAccount() {
    setAccountForm(blankAccount())
    setAccountModal({ mode: 'add' })
  }

  function openEditAccount(account: Account) {
    setAccountForm({ name: account.name, kind: account.kind, opening_balance: account.opening_balance })
    setAccountModal({ mode: 'edit', account })
  }

  function openAddTransfer() {
    setTransferForm(blankTransfer(accounts))
    setTransferOpen(true)
  }

  async function saveAccount() {
    if (busy) return
    const name = accountForm.name.trim()
    if (!name) return onNotify('Enter a name for this account.')
    if (accountForm.opening_balance < 0) return onNotify('Opening balance cannot be negative.')
    try {
      setBusy(true)
      if (accountModal?.mode === 'edit') {
        await actions.updateAccount(accountModal.account.id, {
          name,
          kind: accountForm.kind,
          opening_balance: accountForm.opening_balance,
        })
        onNotify('Account updated.')
      } else {
        await actions.addAccount({ ...accountForm, name })
        onNotify('Account added.')
      }
      setAccountModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this account.')
    } finally {
      setBusy(false)
    }
  }

  async function removeAccount(account: Account) {
    if (account.id === 'cash' || account.id === 'bank') return
    if (!window.confirm(`Remove "${account.name}"? Entries using it will move to Bank balance.`)) return
    try {
      await actions.deleteAccount(account.id)
      onNotify('Account removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this account.')
    }
  }

  async function saveTransfer() {
    if (busy) return
    const amount = Number(transferForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) return onNotify('Enter a transfer amount above zero.')
    if (transferForm.from_account === transferForm.to_account) return onNotify('Choose two different accounts.')
    if (!transferForm.date) return onNotify('Choose a transfer date.')
    try {
      setBusy(true)
      await actions.addTransfer({ ...transferForm, amount })
      onNotify('Transfer recorded — net worth is unchanged.')
      setTransferOpen(false)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not record this transfer.')
    } finally {
      setBusy(false)
    }
  }

  async function removeTransfer(transfer: Transfer) {
    if (!window.confirm('Remove this transfer?')) return
    try {
      await actions.deleteTransfer(transfer.id)
      onNotify('Transfer removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this transfer.')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Money buckets</span>
          <h1>Accounts</h1>
          <p>Give each pot of money its own balance — cash, bank, or something like a farm-house build fund.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={openAddTransfer}><ArrowRight size={16} /> Transfer</button>
          <button className="btn btn-primary" onClick={openAddAccount}><Plus size={16} /> Add account</button>
        </div>
      </header>

      <div className="stat-strip">
        <div><span>Accounts</span><strong>{accounts.length}</strong></div>
        <div><span>Total opening balance</span><strong>{formatMoney(totalOpening, currency)}</strong></div>
        <div><span>Projected net worth</span><strong>{formatMoney(endingTotal, currency)}</strong></div>
        <div><span>Transfers recorded</span><strong>{transfers.length}</strong></div>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Your accounts</h2>
            <p>Every account counts toward net worth and the forecast. Cash and bank are built in.</p>
          </div>
        </div>
        {accounts.length ? (
          <div className="ledger-list">
            {accounts.map((account) => {
              const projected = simulation.accountBalances[account.id] ?? 0
              const delta = projected - account.opening_balance
              return (
                <div className="ledger-row" key={account.id}>
                  <div className="ledger-main">
                    <strong>{account.name}</strong>
                    <span>{kindLabel(account.kind)}{account.id === 'cash' || account.id === 'bank' ? ' · built in' : ''}</span>
                  </div>
                  <div className="account-pair"><span>Opening</span></div>
                  <b>{formatMoney(account.opening_balance, currency)}</b>
                  <div className="ledger-balance">
                    {formatMoney(projected, currency)}
                    <span className={delta >= 0 ? 'positive' : 'negative'}> ({delta >= 0 ? '+' : ''}{formatMoney(delta, currency)})</span>
                  </div>
                  <div className="row-actions">
                    <button className="icon-button" title="Edit account" onClick={() => openEditAccount(account)}><Pencil size={16} /></button>
                    {account.id !== 'cash' && account.id !== 'bank' && (
                      <button className="icon-button danger" title="Delete account" onClick={() => void removeAccount(account)}><Trash2 size={16} /></button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="preview-empty">No accounts yet. Add one to start tracking a separate pot of money.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Transfers</h2>
            <p>Moving money between your own accounts never changes your net worth — both sides carry the same amount.</p>
          </div>
          <button className="btn btn-outline btn-small" onClick={openAddTransfer}><Plus size={15} /> Record transfer</button>
        </div>
        {transfers.length ? (
          <div className="ledger-list">
            {transfers.map((transfer) => (
              <div className="ledger-row" key={transfer.id}>
                <div className="ledger-date">{transfer.date}</div>
                <div className="ledger-main">
                  <strong>{label(transfer.from_account)} <ArrowRight size={13} /> {label(transfer.to_account)}</strong>
                  <span>{transfer.note || 'Account transfer'}</span>
                </div>
                <b>{formatMoney(transfer.amount, currency)}</b>
                <div className="ledger-balance">Net-neutral</div>
                <div className="row-actions">
                  <button className="icon-button danger" title="Delete transfer" onClick={() => void removeTransfer(transfer)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="preview-empty">No transfers yet. Use one to fund a dedicated account without counting it as income.</p>
        )}
      </section>

      {accountModal && (
        <Modal
          title={accountModal.mode === 'edit' ? 'Edit account' : 'Add an account'}
          subtitle="Opening balance is the money already in this account when your plan begins."
          onClose={() => setAccountModal(null)}
        >
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveAccount() }}>
            <label className="field">
              <span>Account name</span>
              <input
                value={accountForm.name}
                onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })}
                placeholder="e.g. Farm house build"
                required
              />
            </label>
            <label className="field">
              <span>Account type</span>
              <select
                value={accountForm.kind}
                onChange={(event) => setAccountForm({ ...accountForm, kind: event.target.value as NewAccount['kind'] })}
              >
                <option value="other">Custom fund</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
            </label>
            <label className="field">
              <span>Opening balance ({currency})</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={accountForm.opening_balance}
                onChange={(event) => setAccountForm({ ...accountForm, opening_balance: Number(event.target.value) || 0 })}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAccountModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {accountModal.mode === 'edit' ? 'Save changes' : 'Add account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {transferOpen && (
        <Modal
          title="Record a transfer"
          subtitle="Money leaves one account and arrives in another — your total stays the same."
          onClose={() => setTransferOpen(false)}
        >
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveTransfer() }}>
            <div className="form-grid">
              <label className="field">
                <span>From account</span>
                <select
                  value={transferForm.from_account}
                  onChange={(event) => setTransferForm({ ...transferForm, from_account: event.target.value })}
                >
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>To account</span>
                <select
                  value={transferForm.to_account}
                  onChange={(event) => setTransferForm({ ...transferForm, to_account: event.target.value })}
                >
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Amount ({currency})</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={transferForm.amount || ''}
                  onChange={(event) => setTransferForm({ ...transferForm, amount: Number(event.target.value) || 0 })}
                  required
                />
              </label>
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={transferForm.date}
                  onChange={(event) => setTransferForm({ ...transferForm, date: event.target.value })}
                  required
                />
              </label>
              <label className="field field-span-2">
                <span>Note <span className="muted">(optional)</span></span>
                <input
                  value={transferForm.note}
                  onChange={(event) => setTransferForm({ ...transferForm, note: event.target.value })}
                  placeholder="e.g. Move funds to the farm house account"
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={() => setTransferOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>Record transfer</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
