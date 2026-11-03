'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Mail, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Collegamento della casella email: fornitore, indirizzo e password (per le app).

type Preset = { id: string; label: string; domains: string[]; passwordHelp: string; passwordUrl?: string }
type Connection = { id: string; platform: string; account: string; status: string; error: string | null; lastSync: string | null }

const field =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

export default function EmailChannelPage() {
  const { appFetch, workspace } = useWorkspace()
  const [presets, setPresets] = useState<Preset[]>([])
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [preset, setPreset] = useState('gmail')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/channels').catch(() => null)
    const data = res?.ok ? await res.json() : { connections: [] }
    setConnections((data.connections || []).filter((c: Connection) => c.platform === 'email'))
  }, [appFetch])

  useEffect(() => {
    load()
    fetch('/api/app/channels/email')
      .then((r) => r.json())
      .then((d) => setPresets(d.presets || []))
      .catch(() => undefined)
  }, [load])

  useEffect(() => {
    if (workspace && !displayName) setDisplayName(workspace.name)
  }, [workspace, displayName])

  // Indirizzo @gmail.com, @libero.it...: il fornitore si sceglie da solo.
  const onEmail = (value: string) => {
    setEmail(value)
    const domain = value.split('@')[1]?.toLowerCase()
    const match = presets.find((p) => domain && p.domains.includes(domain))
    if (match) setPreset(match.id)
  }

  const current = presets.find((p) => p.id === preset)
  const custom = preset === 'custom'

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await appFetch('/api/app/channels/email', {
      method: 'POST',
      body: JSON.stringify({ preset, email, password, displayName, imapHost, imapPort, smtpHost, smtpPort }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setError(data.error || 'Connessione non riuscita, riprova.')
    setPassword('')
    await load()
  }

  const disconnect = async (id: string) => {
    if (!confirm('Scollegare questa casella? I messaggi già ricevuti restano nell’omnichat.')) return
    await appFetch(`/api/app/channels/email?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
    await load()
  }

  return (
    <div className="max-w-xl">
      <Link href="/app" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <ArrowLeft className="h-4 w-4" /> Panoramica
      </Link>
      <h1 className="mt-4 flex items-center gap-3 text-3xl font-extrabold">
        <Mail className="h-7 w-7 text-[var(--accent-blue)]" /> Email
      </h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Collega la casella dell’attività: le email dei clienti arrivano nell’omnichat e l’AI può prepararti le risposte.
      </p>

      {connections?.map((c) => (
        <div key={c.id} className="mt-6 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className={`h-5 w-5 ${c.status === 'connected' ? 'text-[#34C759]' : 'text-[#FF9500]'}`} />
            <p className="min-w-0 flex-1 truncate font-semibold">{c.account}</p>
            {canManage && (
              <button onClick={() => disconnect(c.id)} aria-label="Scollega" className="text-[var(--text-secondary)] hover:text-[#ff6b6b]">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {c.error
              ? c.error
              : c.lastSync
                ? `Collegata. Ultimo controllo: ${new Date(c.lastSync).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}.`
                : 'Collegata. Le email degli ultimi 3 giorni arrivano al primo controllo.'}
          </p>
          <Link href="/app/omnichat" className="mt-3 inline-block text-sm font-semibold text-[var(--accent-blue)]">
            Apri l’omnichat →
          </Link>
        </div>
      ))}

      {canManage && connections !== null && (
        <form onSubmit={connect} className="mt-8 space-y-4">
          <h2 className="text-lg font-bold">{connections.length ? 'Collega un’altra casella' : 'Collega la casella'}</h2>

          <div className="flex flex-wrap gap-2">
            {[...presets, { id: 'custom', label: 'Altro' } as Preset].map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  preset === p.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <input className={field} type="email" autoComplete="off" placeholder="Indirizzo email (es. info@tuaattivita.it)" value={email} onChange={(e) => onEmail(e.target.value)} />

          {current && (
            <p className="rounded-xl bg-[var(--background-secondary)] p-3 text-sm text-[var(--text-secondary)]">
              {current.passwordHelp}{' '}
              {current.passwordUrl && (
                <a href={current.passwordUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-blue)]">
                  Apri la pagina <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
          {custom && (
            <p className="rounded-xl bg-[var(--background-secondary)] p-3 text-sm text-[var(--text-secondary)]">
              Trovi server e porte nelle impostazioni della tua posta, o chiedili a chi gestisce il tuo dominio. Outlook e Hotmail non sono ancora
              supportati.
            </p>
          )}

          <input
            className={field}
            type="password"
            autoComplete="new-password"
            placeholder={preset === 'gmail' ? 'Password per le app (16 lettere)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {custom && (
            <div className="grid grid-cols-3 gap-2">
              <input className={`${field} col-span-2`} placeholder="Server IMAP (es. imap.dominio.it)" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
              <select className={field} value={imapPort} onChange={(e) => setImapPort(e.target.value)} aria-label="Porta IMAP">
                <option value="993">993</option>
                <option value="143">143</option>
              </select>
              <input className={`${field} col-span-2`} placeholder="Server SMTP (es. smtp.dominio.it)" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              <select className={field} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} aria-label="Porta SMTP">
                <option value="465">465</option>
                <option value="587">587</option>
              </select>
            </div>
          )}

          <label className="block text-sm text-[var(--text-secondary)]">
            Nome del mittente nelle risposte
            <input className={`${field} mt-1`} value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? 'Controllo la casella…' : 'Collega'}
          </button>
          <p className="text-xs text-[var(--text-secondary)]">
            La password viene salvata cifrata e usata solo per leggere e inviare le email di questa casella. Puoi scollegarla quando vuoi.
          </p>
        </form>
      )}
      {!canManage && <p className="mt-6 text-sm text-[var(--text-secondary)]">Solo gli amministratori dello spazio possono collegare le caselle.</p>}
    </div>
  )
}
