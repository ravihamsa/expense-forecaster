import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Lock, Mail, ShieldCheck, Sparkles, User, Wallet } from 'lucide-react'
import { signIn, signUp, usingSupabase } from '../lib/data'

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const result = await signUp(email, password, name)
        if (result.needsConfirmation) {
          setNotice('Check your email to confirm your account, then sign in.')
          setMode('signin')
        }
      } else {
        await signIn(email, password)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />

      <div className="auth-shell">
        <section className="auth-story">
          <div className="brand brand-large">
            <span className="brand-mark"><Wallet size={22} strokeWidth={2.4} /></span>
            <span>Fin<span className="brand-accent">Plannar</span></span>
          </div>
          <h1>Know your cash flow <em>before</em> it happens.</h1>
          <p className="auth-story-copy">
            Map every monthly bill, one-off expense and loan. See surplus and deficit months months in
            advance — and get a clear plan to balance it all out.
          </p>
          <div className="auth-features">
            <div><CheckCircle2 size={18} /><span>12–36 month cash flow forecast</span></div>
            <div><CheckCircle2 size={18} /><span>Monthly, yearly and custom recurring plans</span></div>
            <div><CheckCircle2 size={18} /><span>Loan payoff and prepayment suggestions</span></div>
          </div>
          <div className="auth-story-footer">
            <Sparkles size={16} /> Built for calm, confident money decisions.
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-card-head">
            <span className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Start planning'}</span>
            <h2>{mode === 'signin' ? 'Sign in to your plan' : 'Create your account'}</h2>
            <p>{mode === 'signin' ? 'Pick up right where you left off.' : 'Free to use. Your data stays private to you.'}</p>
          </div>

          <form onSubmit={handleSubmit} className="form-stack">
            {mode === 'signup' && (
              <label className="field">
                <span>Your name</span>
                <div className="input-wrap"><User size={17} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ananya" required /></div>
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <div className="input-wrap"><Mail size={17} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" /></div>
            </label>
            <label className="field">
              <span>Password</span>
              <div className="input-wrap"><Lock size={17} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></div>
            </label>

            {error && <div className="alert alert-error">{error}</div>}
            {notice && <div className="alert alert-success">{notice}</div>}

            <button type="submit" className="btn btn-primary btn-full" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
            <button
              className="link-button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setError('')
                setNotice('')
              }}
            >
              {mode === 'signin' ? 'Sign up free' : 'Sign in'}
            </button>
          </div>

          <div className="auth-mode-note">
            <ShieldCheck size={15} />
            {usingSupabase
              ? 'Secure accounts powered by Supabase Auth.'
              : 'Demo mode — data is stored privately in this browser. Add Supabase keys to sync across devices.'}
          </div>
        </section>
      </div>
    </div>
  )
}
