'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Check, Facebook, Instagram, Loader2, PencilLine } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Contenuti programmati: elenco dei post in uscita. Da qui si cambia SOLO giorno e ora;
// per modificare il contenuto si toglie la programmazione e si riapre la chat in cui si
// era lavorato a quel post (le chat restano tutte salvate).

type Post = {
  id: string
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  title: string | null
  caption: string
  media: string[]
  platforms: ('instagram' | 'facebook')[]
  publish_at: string | null
  error_message: string | null
}

/** "2026-11-07T18:30" nell'ora del telefono, per il campo data e ora. */
const toLocalInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const whenLabel = (iso: string) => new Date(iso).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export default function ScheduledPage() {
  const { appFetch, workspace } = useWorkspace()
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/posts').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    const list = ((data?.posts || []) as Post[])
      .filter((p) => p.status === 'scheduled' || p.status === 'publishing' || (p.status === 'failed' && p.publish_at))
      .sort((a, b) => (a.publish_at || '').localeCompare(b.publish_at || ''))
    setPosts(list)
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold">Contenuti programmati</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">I post in uscita. Tocca un post per cambiare giorno e ora, o per modificarlo.</p>
      </div>
      {posts === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : !posts.length ? (
        <p className="text-sm text-[var(--text-secondary)]">Nessun contenuto programmato. Li programmi dall’Assistente, sotto l’anteprima del post.</p>
      ) : (
        posts.map((post) => (
          <ScheduledCard
            key={post.id}
            post={post}
            open={open === post.id}
            canManage={canManage}
            onToggle={() => setOpen((o) => (o === post.id ? null : post.id))}
            onChange={(next) => setPosts((list) => (list || []).map((p) => (p.id === next.id ? next : p)))}
          />
        ))
      )}
    </div>
  )
}

function ScheduledCard({ post, open, canManage, onToggle, onChange }: { post: Post; open: boolean; canManage: boolean; onToggle: () => void; onChange: (post: Post) => void }) {
  const { appFetch } = useWorkspace()
  const router = useRouter()
  const [when, setWhen] = useState(toLocalInput(post.publish_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => setWhen(toLocalInput(post.publish_at)), [post.publish_at])

  const patch = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/posts', { method: 'PATCH', body: JSON.stringify({ id: post.id, action, base: post.media, ...extra }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (data.post) onChange(data.post)
    if (!res?.ok) setError(data.error || 'Operazione non riuscita, riprova.')
    return Boolean(res?.ok)
  }

  const saveTime = async () => {
    if (await patch('schedule', { publishAt: new Date(when).toISOString() })) setNotice('Orario cambiato.')
  }

  /** Per modificare il contenuto: via la programmazione, poi la chat in cui si era lavorato al post. */
  const edit = async () => {
    if (!confirm('Per modificare il post tolgo la programmazione (torna in bozza) e riapro la chat in cui ci avevi lavorato. Continuare?')) return
    if ((post.status === 'scheduled' || post.status === 'failed') && !(await patch('unschedule'))) return
    router.push(`/app/assistente?post=${post.id}`)
  }

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        {post.media[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.media[0]} alt="" className="h-20 w-16 shrink-0 rounded-lg object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{post.title || 'Post'}</p>
          <p className={`mt-0.5 text-sm ${post.status === 'failed' ? 'text-[#FF3B30]' : 'text-[var(--accent-blue)]'}`}>
            {post.status === 'failed' ? 'Non pubblicato' : post.status === 'publishing' ? 'In pubblicazione…' : 'Programmato'}
            {post.publish_at ? ` · ${whenLabel(post.publish_at)}` : ''}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            {post.platforms.includes('instagram') && <Instagram className="h-3.5 w-3.5" />}
            {post.platforms.includes('facebook') && <Facebook className="h-3.5 w-3.5" />}
            {post.media.length} {post.media.length === 1 ? 'immagine' : 'slide'}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-[var(--border-color)] pt-3">
          <div className="flex snap-x gap-2 overflow-x-auto pb-1">
            {post.media.map((url, n) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={`Slide ${n + 1}`} loading="lazy" className="h-40 w-32 shrink-0 snap-start rounded-lg border border-[var(--border-color)] object-cover" />
            ))}
          </div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{post.caption}</p>
          {post.status === 'failed' && post.error_message && <p className="mt-2 text-xs text-[#FF3B30]">{post.error_message}</p>}
          {error && <p className="mt-2 text-xs text-[#FF3B30]">{error}</p>}
          {notice && <p className="mt-2 text-xs text-[#34C759]">{notice}</p>}
          {canManage && post.status !== 'publishing' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                <CalendarClock className="h-4 w-4" />
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--text-primary)]"
                />
              </label>
              <button
                onClick={saveTime}
                disabled={busy !== null || when === toLocalInput(post.publish_at)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {post.status === 'failed' ? 'Riprogramma' : 'Salva orario'}
              </button>
              <button
                onClick={edit}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy === 'unschedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />} Modifica il contenuto
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
