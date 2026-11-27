import { useMemo, useState } from 'react'
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import CategoryBadge from '../components/CategoryBadge'
import Modal from '../components/Modal'
import { categoriesOfKind } from '../lib/categories'
import type { AppActions, AppCategory, AppData, FlowKind, NewCategory } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  onNotify: (message: string) => void
}

type ModalState = { mode: 'add' } | { mode: 'edit'; category: AppCategory }

export default function Categories({ data, actions, onNotify }: Props) {
  const [kind, setKind] = useState<FlowKind>('expense')
  const [modal, setModal] = useState<ModalState | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const categories = useMemo(
    () => data.categories
      .filter((category) => category.kind === kind)
      .sort((a, b) => {
        const aOther = a.name.toLowerCase() === 'other'
        const bOther = b.name.toLowerCase() === 'other'
        if (aOther !== bOther) return aOther ? 1 : -1
        return a.name.localeCompare(b.name)
      }),
    [data.categories, kind],
  )

  function usageCount(category: AppCategory): number {
    const flows = data.cashFlows.filter((row) => row.kind === category.kind && row.category === category.name).length
    const rules = data.vendorRules.filter((row) => row.kind === category.kind && row.category === category.name).length
    const actuals = data.actuals.filter((row) => row.kind === category.kind && row.category === category.name).length
    const budgets = category.kind === 'expense'
      ? data.budgets.filter((row) => row.category === category.name).length
      : 0
    return flows + rules + actuals + budgets
  }

  function openAdd() {
    setName('')
    setModal({ mode: 'add' })
  }

  function openEdit(category: AppCategory) {
    setName(category.name)
    setModal({ mode: 'edit', category })
  }

  async function save() {
    if (!modal || busy) return
    const clean = name.trim()
    if (!clean) return onNotify('Enter a category name.')
    try {
      setBusy(true)
      if (modal.mode === 'edit') {
        await actions.renameCategory(modal.category.id, clean)
      } else {
        const input: NewCategory = { name: clean, kind }
        await actions.addCategory(input)
      }
      setModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this category.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(category: AppCategory) {
    if (category.name.toLowerCase() === 'other') return
    const used = usageCount(category)
    const message = used > 0
      ? `Remove "${category.name}"? ${used} item${used === 1 ? '' : 's'} using it will move to Other.`
      : `Remove "${category.name}"?`
    if (!window.confirm(message)) return
    try {
      await actions.deleteCategory(category.id)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this category.')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Reusable lists</span>
          <h1>Categories</h1>
          <p>Build one list for expenses and one for income. Every cash flow, budget and SMS rule picks from it.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add category</button>
        </div>
      </header>

      <section className="card">
        <div className="card-head category-card-head">
          <div>
            <h2>Your categories</h2>
            <p>Rename or remove anything except Other, which is the fallback for removed categories.</p>
          </div>
          <div className="segmented" role="group" aria-label="Category type">
            <button type="button" className={kind === 'expense' ? 'segment-active' : ''} onClick={() => setKind('expense')}>
              Expense ({categoriesOfKind(data.categories, 'expense').length})
            </button>
            <button type="button" className={kind === 'income' ? 'segment-active' : ''} onClick={() => setKind('income')}>
              Income ({categoriesOfKind(data.categories, 'income').length})
            </button>
          </div>
        </div>

        {categories.length ? (
          <div className="category-list">
            {categories.map((category) => {
              const used = usageCount(category)
              const isOther = category.name.toLowerCase() === 'other'
              return (
                <div className="category-row" key={category.id}>
                  <div className="category-main">
                    <div className="category-title">
                      <CategoryBadge name={category.name} size={20} className="category-badge-lg" />
                      <strong>{category.name}</strong>
                    </div>
                    <div className="category-meta">
                      <span className="category-usage">
                        {used ? `Used by ${used} item${used === 1 ? '' : 's'}` : 'Unused'}
                      </span>
                      {isOther && <span className="mini-tag">fallback</span>}
                    </div>
                  </div>
                  <div className="row-actions">
                    {!isOther && (
                      <>
                        <button className="icon-button" title={`Rename ${category.name}`} onClick={() => openEdit(category)}><Pencil size={16} /></button>
                        <button className="icon-button danger" title={`Remove ${category.name}`} onClick={() => void remove(category)}><Trash2 size={16} /></button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="category-empty">
            <Tag size={26} />
            <strong>No {kind} categories yet</strong>
            <span>Add one to reuse it across your plan.</span>
            <button className="btn btn-primary btn-small" onClick={openAdd}><Plus size={14} /> Add category</button>
          </div>
        )}
      </section>

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Rename category' : `Add ${kind} category`}
          subtitle="This name becomes available everywhere in the planner."
          onClose={() => setModal(null)}
        >
          <label className="field">
            <span>Category name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === 'income' ? 'e.g. Rental income' : 'e.g. Pet care'}
              autoFocus
              required
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : modal.mode === 'edit' ? 'Rename' : 'Add category'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
