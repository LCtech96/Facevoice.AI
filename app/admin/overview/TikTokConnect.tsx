'use client'

import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, ExternalLink, Heart, Loader2, MessageCircle, Music2, Play, RefreshCw, Share2 } from 'lucide-react'

// Collegamento con TikTok nei Canali: «Collega TikTok» (accesso su TikTok e permessi),
// profilo con i numeri e gli ultimi video pubblici. La pubblicazione dei video si fa da
// «Post programmati» → «Nuovo video», scegliendo TikTok.

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>

type Profile = {
  displayName: string
  username: string | null
  avatarUrl: string | null
  bio: string | null
  profileUrl: string | null
  verified: boolean
  followers: number | null
  following: number | null
  likes: number | null
  videos: number | null
}

type Video = { id: string; title: string; cover: string | null; url: string | null; createdAt: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null }

type Status = {
  configured: boolean
  connected: boolean
  connectedAt?: string
  missingScopes?: string[]
  profile?: Profile | null
  videos?: Video[]
  error?: string | null
  needsReconnect?: boolean
}

const RESULT: Record<string, string> = {
  connected: 'TikTok collegato.',
  denied: 'Collegamento annullato su TikTok.',
  invalid: 'Link di collegamento scaduto: riprova.',
  error: 'TikTok non ha completato il collegamento: riprova.',
}

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? new Intl.NumberFormat('it-IT', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n) : '–')

export default function TikTokConnect({ authFetch }: { authFetch: AuthFetch }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/tiktok')
    if (res.ok) setStatus(await res.json())
  }, [authFetch])

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('tiktok')
    if (result && RESULT[result]) setMessage(RESULT[result])
    load().catch(() => undefined)
  }, [load])

  const run = async (init: RequestInit) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await authFetch('/api/admin/tiktok', init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Operazione non riuscita')
      return data
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Errore')
      return null
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    const data = await run({ method: 'POST', body: JSON.stringify({ action: 'connect' }) })
    if (data?.url) window.location.href = data.url
  }

  const disconnect = async () => {
    if (!window.confirm('Scollegare TikTok? I video programmati per TikTok non potranno uscire finché non lo ricolleghi.')) return
    if (await run({ method: 'DELETE' })) await load()
  }

  const refresh = async () => {
    setBusy(true)
    await load().catch(() => undefined)
    setBusy(false)
  }

  if (!status) return null
  const p = status.profile

  return (
    <div className="mb-6 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {p?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-[var(--text-primary)]/10 flex items-center justify-center shrink-0">
              <Music2 className="w-4.5 h-4.5 text-[var(--text-primary)]" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)] flex items-center gap-1">
              {status.connected && p ? p.displayName || 'TikTok' : 'TikTok'}
              {p?.verified && <BadgeCheck className="w-4 h-4 text-[#20D5EC]" />}
              {p?.username && <span className="text-sm font-normal text-[var(--text-secondary)]">@{p.username}</span>}
            </p>
            <p className="text-sm text-[var(--text-secondary)] break-words">
              {status.connected
                ? 'Collegato. I video si pubblicano da «Post programmati» → «Nuovo video», scegliendo TikTok.'
                : status.configured
                  ? 'Collega l’account TikTok per vedere profilo e video e pubblicare i video da qui.'
                  : 'Mancano TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nelle variabili di Vercel.'}
            </p>
            {status.connected && !!status.missingScopes?.length && (
              <p className="text-xs text-[#FF9500] mt-1">Permessi non accettati: {status.missingScopes.join(', ')}. Ricollega e accettali tutti.</p>
            )}
            {status.error && <p className="text-xs text-red-500 mt-1">{status.error}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {status.connected ? (
            <>
              <button onClick={refresh} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Aggiorna
              </button>
              {status.needsReconnect && (
                <button onClick={connect} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white disabled:opacity-50">
                  Ricollega
                </button>
              )}
              <button onClick={disconnect} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm text-[#FF3B30] border border-[var(--border-color)] disabled:opacity-50">
                Scollega
              </button>
            </>
          ) : (
            <button onClick={connect} disabled={busy || !status.configured} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Collega TikTok
            </button>
          )}
        </div>
      </div>

      {status.connected && p && (
        <div className="grid grid-cols-4 gap-2 mt-4 text-center">
          {[
            ['Follower', p.followers],
            ['Seguiti', p.following],
            ['Mi piace', p.likes],
            ['Video', p.videos],
          ].map(([label, value]) => (
            <div key={label as string} className="p-2 rounded-lg bg-[var(--background-secondary)]">
              <p className="text-base font-semibold text-[var(--text-primary)]">{fmt(value as number | null)}</p>
              <p className="text-xs text-[var(--text-secondary)]">{label}</p>
            </div>
          ))}
        </div>
      )}

      {status.connected && !!status.videos?.length && (
        <div className="mt-4">
          <p className="text-xs text-[var(--text-secondary)] mb-2">Ultimi video pubblici</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {status.videos.map((v) => (
              <a key={v.id} href={v.url || '#'} target="_blank" rel="noopener noreferrer" className="group block rounded-lg overflow-hidden border border-[var(--border-color)]">
                <div className="relative aspect-[9/16] bg-black">
                  {v.cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.cover} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  )}
                  <span className="absolute bottom-1 left-1 flex items-center gap-0.5 text-[10px] text-white bg-black/50 rounded px-1">
                    <Play className="w-2.5 h-2.5" /> {fmt(v.views)}
                  </span>
                  <ExternalLink className="absolute top-1 right-1 w-3 h-3 text-white opacity-0 group-hover:opacity-100" />
                </div>
                <div className="p-1.5 space-y-0.5">
                  <p className="text-[11px] text-[var(--text-primary)] line-clamp-2 min-h-[2em]">{v.title || '(senza titolo)'}</p>
                  <p className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                    <Heart className="w-2.5 h-2.5" /> {fmt(v.likes)} <MessageCircle className="w-2.5 h-2.5" /> {fmt(v.comments)} <Share2 className="w-2.5 h-2.5" /> {fmt(v.shares)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      {message && <p className="text-sm text-[var(--text-secondary)] mt-3">{message}</p>}
    </div>
  )
}
