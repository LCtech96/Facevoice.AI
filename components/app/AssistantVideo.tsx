'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Clapperboard, Film, Loader2, Trash2, X } from 'lucide-react'
import { VideoChip, uploadVideo } from '@/components/app/VideoReplies'
import { VIDEO_REPLY_CHANNEL_LABELS, formatSize, type VideoReplyChannel } from '@/lib/saas/video-replies-shared'

// Video nella chat dell'Assistente (video risposte): pulsante per allegare un video (caricamento
// firmato direttamente nell'archivio, con l'avanzamento), anteprima nel compositore e nei
// messaggi, scheda del video risposta salvata/cambiata/eliminata. Tutto qui, cosi' la pagina
// dell'Assistente cambia solo di poche righe.

export type ChatVideo = { url: string; name: string; size: number }
export type VideoReplyAction = {
  kind: 'video_reply'
  op: 'created' | 'updated' | 'deleted'
  at: string
  video: { id: string; title: string; trigger: string; channels: VideoReplyChannel[]; active: boolean; oncePerPerson: boolean; url: string; warning?: string | null }
}

type AppFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Stato del video allegato nel compositore. */
export function useChatVideo(appFetch: AppFetch) {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [video, setVideo] = useState<ChatVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const pick = async (picked: File | undefined) => {
    if (!picked) return
    setError(null)
    setVideo(null)
    setFile(picked)
    setProgress(0)
    try {
      const url = await uploadVideo(appFetch, picked, setProgress)
      setVideo({ url, name: picked.name, size: picked.size })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito, riprova.')
      setFile(null)
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  const clear = () => {
    setFile(null)
    setVideo(null)
    setError(null)
    setProgress(null)
  }

  /** Dopo un invio non riuscito il video torna nel compositore. */
  const restore = (saved: ChatVideo | null) => {
    if (!saved) return
    setVideo(saved)
    setFile(null)
  }

  const uploading = progress !== null

  const button = (disabled: boolean) => (
    <>
      <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button onClick={() => input.current?.click()} disabled={disabled || uploading} aria-label="Allega video" title="Allega un video (video risposte)" className="p-2 text-[var(--text-secondary)] disabled:opacity-40">
        <Film className="h-5 w-5" />
      </button>
    </>
  )

  const chip =
    file || video || error ? (
      <div className="mb-2 flex items-center gap-2 text-xs">
        {error ? (
          <span className="text-[#FF3B30]">{error}</span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--background-secondary)] px-2 py-1.5">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-blue)]" /> : <Check className="h-4 w-4 text-[#34C759]" />}
            <Film className="h-4 w-4" />
            <span translate="no" className="max-w-[12rem] truncate">
              {video?.name || file?.name}
            </span>
            <span className="text-[var(--text-secondary)]">{uploading ? `${progress}%` : formatSize(video?.size || file?.size || 0)}</span>
          </span>
        )}
        <button onClick={clear} aria-label="Togli il video" className="rounded-full p-0.5">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : null

  return { video, uploading, button, chip, clear, restore }
}

/** Video allegato a un messaggio del cliente nella chat. */
export function TurnVideo({ video }: { video: ChatVideo }) {
  return (
    <div className="mb-2 flex justify-end">
      <video src={video.url} controls playsInline preload="metadata" className="h-40 max-w-[12rem] rounded-lg bg-black" />
    </div>
  )
}

const OP_TEXT: Record<VideoReplyAction['op'], string> = { created: 'Video risposta salvata', updated: 'Video risposta modificata', deleted: 'Video risposta eliminata' }

/** Scheda del video risposta (dopo la conferma o una modifica). */
export function VideoReplyActionCard({ action }: { action: VideoReplyAction }) {
  const v = action.video
  const Icon = action.op === 'deleted' ? Trash2 : Clapperboard
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-[var(--accent-blue)]" /> {OP_TEXT[action.op]}
      </p>
      <VideoChip
        className="mt-2"
        title={v.title}
        url={action.op === 'deleted' ? null : v.url}
        note={`Quando: ${v.trigger} · ${v.channels.map((c) => VIDEO_REPLY_CHANNEL_LABELS[c]).join(' e ')}${v.active ? '' : ' · spenta'}${v.oncePerPerson ? ' · una volta per persona' : ''}`}
      />
      {v.warning && <p className="mt-2 text-xs text-[#FF9500]">{v.warning}</p>}
      <Link href="/app/istruzioni" className="mt-2 inline-flex text-sm font-medium text-[var(--accent-blue)]">
        Tutte le video risposte (Istruzioni)
      </Link>
    </div>
  )
}

/** Anteprima del video nella scheda di conferma. */
export function PendingVideo({ video }: { video?: { url: string; title: string } }) {
  return video ? <VideoChip className="mt-2" title={video.title} url={video.url} /> : null
}
