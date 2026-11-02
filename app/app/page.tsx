'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Facebook, Globe, Instagram, Mail, MessageCircle } from 'lucide-react'
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
  const { workspace, appFetch } = useWorkspace()
  const [channels, setChannels] = useState<Channel[] | null>(null)

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
      <h1 className="text-3xl font-extrabold">{workspace?.name}</h1>
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
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">{on && channel.handle ? channel.handle : info.soon}</p>
                  {!on && <p className="mt-2 text-xs text-[var(--text-secondary)]">Il collegamento arriva a breve.</p>}
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
