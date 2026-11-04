'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Facebook, Instagram, Loader2, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Collegamento di Pagina Facebook e Instagram professionale con il login di Meta.

type Connection = { id: string; platform: string; account: string; name: string | null; status: string; error: string | null; via: string | null }

function MetaChannels() {
  const { appFetch, workspace } = useWorkspace()
  const params = useSearchParams()
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [busy, setBusy] = useState<'meta' | 'instagram' | null>(null)
  const [error, setError] = useState<string | null>(params.get('error'))
  const ok = params.get('ok')
  const skipped = params.get('skipped')
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/channels').catch(() => null)
    const data = res?.ok ? await res.json() : { connections: [] }
    setConnections((data.connections || []).filter((c: Connection) => c.platform === 'facebook' || c.platform === 'instagram'))
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const connect = async (kind: 'meta' | 'instagram') => {
    setBusy(kind)
    setError(null)
    const res = await appFetch(kind === 'instagram' ? '/api/app/instagram/start' : '/api/app/meta/start', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok || !data.url) {
      setBusy(null)
      return setError(data.error || 'Connessione non riuscita, riprova.')
    }
    window.location.href = data.url
  }

  const disconnect = async (c: Connection) => {
    const question =
      c.via === 'instagram_login'
        ? 'Scollegare questo Instagram? I messaggi già ricevuti restano nell’omnichat.'
        : 'Scollegare questa Pagina (e il suo Instagram)? I messaggi già ricevuti restano nell’omnichat.'
    if (!confirm(question)) return
    const id = c.id
    await appFetch(`/api/app/channels/meta?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
    await load()
  }

  return (
    <div className="max-w-xl">
      <Link href="/app" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <ArrowLeft className="h-4 w-4" /> Panoramica
      </Link>
      <h1 className="mt-4 flex items-center gap-3 text-3xl font-extrabold">
        <Facebook className="h-7 w-7 text-[var(--accent-blue)]" />
        <Instagram className="h-7 w-7 text-[var(--accent-blue)]" /> Facebook e Instagram
      </h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Collega la Pagina Facebook della tua attività e il tuo Instagram professionale: i messaggi di Messenger e Direct arrivano
        nell’omnichat e l’AI risponde con le tue istruzioni. Se usi solo Instagram puoi collegarlo direttamente, senza Pagina Facebook.
      </p>

      {ok && (
        <p className="mt-6 rounded-xl border border-[#34C759] p-3 text-sm">
          Collegati: <span translate="no">{ok}</span>
          {skipped ? (
            <>
              <br />
              Non collegati: <span translate="no">{skipped}</span>
            </>
          ) : null}
        </p>
      )}
      {error && <p className="mt-6 text-sm text-[#ff6b6b]">{error}</p>}

      {connections?.map((c) => {
        const Icon = c.platform === 'instagram' ? Instagram : Facebook
        return (
          <div key={c.id} className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
            <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
            <div className="min-w-0 flex-1">
              <p translate="no" className="truncate font-semibold">
                {c.name || c.account}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {c.platform === 'instagram' ? (c.via === 'instagram_login' ? 'Instagram (Direct, accesso Instagram)' : 'Instagram (Direct)') : 'Pagina Facebook (Messenger)'}
              </p>
              {c.status !== 'connected' && c.error && <p className="text-xs text-[#FF9500]">{c.error}</p>}
            </div>
            <CheckCircle2 className={`h-5 w-5 ${c.status === 'connected' ? 'text-[#34C759]' : 'text-[#FF9500]'}`} />
            {canManage && (c.platform === 'facebook' || c.via === 'instagram_login') && (
              <button onClick={() => disconnect(c)} aria-label="Scollega" className="text-[var(--text-secondary)] hover:text-[#ff6b6b]">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      })}

      {canManage && (
        <div className="mt-8 space-y-3">
          <button
            onClick={() => connect('meta')}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1877F2] px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy === 'meta' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-5 w-5" />}
            {connections?.some((c) => c.platform === 'facebook') ? 'Collega un’altra Pagina' : 'Collega Facebook e Instagram'}
          </button>
          <button
            onClick={() => connect('instagram')}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {busy === 'instagram' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-5 w-5" />}
            Collega solo Instagram
          </button>
        </div>
      )}

      <div className="mt-6 space-y-2 text-sm text-[var(--text-secondary)]">
        <p className="font-semibold text-[var(--text-primary)]">Cosa serve</p>
        <p>• Una Pagina Facebook di cui sei amministratore.</p>
        <p>• Per Instagram: un account professionale (aziendale o creator) collegato a quella Pagina.</p>
        <p>• Nella finestra di Facebook scegli la Pagina e l’Instagram da collegare e conferma i permessi.</p>
        <p>• “Collega solo Instagram”: accedi con il tuo Instagram professionale (aziendale o creator), anche senza Pagina Facebook.</p>
        <p className="text-xs">Puoi scollegare la Pagina in qualsiasi momento, da qui o dalle impostazioni di Facebook.</p>
      </div>
    </div>
  )
}

export default function MetaChannelsPage() {
  return (
    <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />}>
      <MetaChannels />
    </Suspense>
  )
}
