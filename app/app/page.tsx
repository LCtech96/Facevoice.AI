'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Check, Facebook, Globe, Instagram, Loader2, Mail, MessageCircle, Pencil, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Panoramica dello spazio di lavoro: stato dei canali e primi passi.

type Channel = { id: string; platform: string; status: string; handle: string | null; automation_enabled: boolean }

const CHANNELS: Record<string, { label: string; icon: typeof Mail; soon: string }> = {
  instagram: { label: 'Instagram', icon: Instagram, soon: 'Messaggi diretti e commenti' },
  facebook: { label: 'Facebook', icon: Facebook, soon: 'Messenger e commenti della Pagina' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, soon: 'Il tuo numero WhatsApp Business' },
  email: { label: 'Email', icon: Mail, soon: 'Gmail, Outlook o qualsiasi casella' },
  web: { label: 'Chat del sito', icon: Globe, soon: 'Una chat AI da mettere sul tuo sito' },
}

export default function OverviewPage() {
  const { workspace, appFetch, reload } = useWorkspace()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const canRename = workspace?.role === 'owner' || workspace?.role === 'admin'

  const startEdit = () => {
    setName(workspace?.name || '')
    setNameError(null)
    setEditing(true)
  }

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === workspace?.name) return setEditing(false)
    setSaving(true)
    setNameError(null)
    const res = await appFetch('/api/app/workspaces', { method: 'PATCH', body: JSON.stringify({ name }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setSaving(false)
    if (!res?.ok) return setNameError(data.error || 'Nome non salvato, riprova.')
    await reload()
    setEditing(false)
  }

  useEffect(() => {
    let alive = true
    appFetch('/api/app/channels')
      .then((res) => (res.ok ? res.json() : { channels: [] }))
      .then((data) => alive && setChannels(data.channels || []))
      .catch(() => alive && setChannels([]))
    return () => {
      alive = false
    }
  }, [appFetch])

  const connected = (channels || []).filter((c) => c.status === 'connected').length
  const order = Object.keys(CHANNELS)
  const list = (channels || []).filter((c) => CHANNELS[c.platform]).sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))

  return (
    <div>
      {editing ? (
        <form onSubmit={saveName} className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            aria-label="Nome della tua attività"
            translate="no"
            className="min-w-0 flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-2xl font-extrabold text-[var(--text-primary)]"
          />
          <button type="submit" disabled={saving || !name.trim()} aria-label="Salva il nome" className="rounded-full bg-[var(--accent-blue)] p-2 text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          </button>
          <button type="button" onClick={() => setEditing(false)} aria-label="Annulla" className="p-2 text-[var(--text-secondary)]">
            <X className="h-5 w-5" />
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <h1 translate="no" className="min-w-0 truncate text-3xl font-extrabold">{workspace?.name}</h1>
          {canRename && (
            <button onClick={startEdit} aria-label="Modifica il nome dell’attività" title="Modifica il nome" className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Pencil className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {nameError && <p className="mt-2 text-sm text-[#ff6b6b]">{nameError}</p>}
      <p className="mt-2 text-[var(--text-secondary)]">
        {connected ? `${connected} ${connected === 1 ? 'canale collegato' : 'canali collegati'}.` : 'Nessun canale collegato: inizia da qui sotto.'}
      </p>

      <h2 className="mt-10 text-lg font-bold">I tuoi canali</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {channels === null
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--background-secondary)]" />)
          : list.map((channel) => {
              const info = CHANNELS[channel.platform]
              const Icon = info.icon
              const on = channel.status === 'connected'
              return (
                <div key={channel.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
                    <p className="font-semibold">{info.label}</p>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${on ? 'bg-[#34C759] text-white' : 'bg-[var(--background)] text-[var(--text-secondary)]'}`}>
                      {on ? 'Collegato' : 'Da collegare'}
                    </span>
                  </div>
                  <p translate={on && channel.handle ? 'no' : undefined} className="mt-2 text-sm text-[var(--text-secondary)]">{on && channel.handle ? channel.handle : info.soon}</p>
                  {channel.platform === 'email' || channel.platform === 'facebook' || channel.platform === 'instagram' ? (
                    <Link href={channel.platform === 'email' ? '/app/canali/email' : `/app/canali/meta?canale=${channel.platform}`} className="mt-3 inline-block text-sm font-semibold text-[var(--accent-blue)]">
                      {on ? 'Gestisci' : 'Collega'} →
                    </Link>
                  ) : (
                    !on && <p className="mt-2 text-xs text-[var(--text-secondary)]">Il collegamento arriva a breve.</p>
                  )}
                </div>
              )
            })}
      </div>

      <h2 className="mt-10 text-lg font-bold">Primi passi</h2>
      <ol className="mt-4 space-y-3 text-[var(--text-secondary)]">
        <li>
          <span className="font-semibold text-[var(--text-primary)]">1. Collega i canali</span>: Instagram, Facebook, WhatsApp, email.
        </li>
        <li>
          <span className="font-semibold text-[var(--text-primary)]">2. Scrivi le istruzioni</span> per l’AI in{' '}
          <Link href="/app/istruzioni" className="text-[var(--accent-blue)]">
            Istruzioni
          </Link>
          : tono, prezzi, cosa dire e cosa no.
        </li>
        <li>
          <span className="font-semibold text-[var(--text-primary)]">3. Accendi l’automazione</span> canale per canale dall’
          <Link href="/app/omnichat" className="text-[var(--accent-blue)]">
            Omnichat
          </Link>
          .
        </li>
      </ol>
    </div>
  )
}
