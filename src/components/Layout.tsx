import { useState, type ReactNode } from 'react'
import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Cloud,
  HardDrive,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  Settings,
  Tags,
  Target,
  Wallet,
  X,
} from 'lucide-react'
import type { AuthUser } from '../lib/data'
import { usingSupabase } from '../lib/data'
import type { Tab } from '../lib/types'

const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cashflows', label: 'Cash flow', icon: ArrowLeftRight },
  { id: 'budgets', label: 'Budgets', icon: Tags },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'actuals', label: 'Actual vs plan', icon: CheckCircle2 },
  { id: 'loans', label: 'Loans', icon: Landmark },
  { id: 'balance', label: 'Balance plan', icon: Scale },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'ledger', label: 'Money trail', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
]

interface Props {
  user: AuthUser
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onSignOut: () => void
  children: ReactNode
}

export default function Layout({ user, activeTab, onTabChange, onSignOut, children }: Props) {
  const [open, setOpen] = useState(false)
  const initials = (user.name || user.email || 'U')
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  function navigate(tab: Tab) {
    onTabChange(tab)
    setOpen(false)
  }

  return (
    <div className="app-shell">
      {open && <button className="sidebar-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark"><Wallet size={20} strokeWidth={2.4} /></span>
            <span>Fin<span className="brand-accent">Plannar</span></span>
            <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <p className="sidebar-tagline">Your money, mapped ahead.</p>
        </div>

        <nav className="nav-list">
          <span className="nav-label">Workspace</span>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeTab === id ? 'nav-item-active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-note">
            {usingSupabase ? <Cloud size={16} /> : <HardDrive size={16} />}
            <div>
              <strong>{usingSupabase ? 'Synced with Supabase' : 'Demo mode'}</strong>
              <span>{usingSupabase ? 'Your plan is saved to the cloud.' : 'Saved in this browser only.'}</span>
            </div>
          </div>
          <div className="user-row">
            <span className="avatar">{initials}</span>
            <div className="user-meta">
              <strong>{user.name || 'My account'}</strong>
              <span>{user.email}</span>
            </div>
            <button className="icon-button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="brand"><Wallet size={18} /> <span>Fin<span className="brand-accent">Plannar</span></span></div>
          <span className="avatar avatar-small">{initials}</span>
        </header>
        <div className="page-container">{children}</div>
      </main>
    </div>
  )
}
