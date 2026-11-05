'use client'

import { Check, Facebook, Instagram, Loader2, Send } from 'lucide-react'
import type { SocialAction } from '@/components/useAssistantChat'
import { useSyncedText } from './useSyncedText'

// Risposta preparata dalla super chat a un messaggio Instagram o Facebook:
// si corregge il testo e parte solo con "Invia".

type SocialMessage = Extract<SocialAction, { kind: 'social_message' }>

export default function MessageCard({ action, onChange, onSend }: { action: SocialMessage; onChange: (text: string) => void; onSend: (text: string) => void }) {
  const [text, setText, flush] = useSyncedText(action.text, onChange)
  const Icon = action.platform === 'instagram' ? Instagram : Facebook
  const old = action.lastIncomingAt ? Date.now() - new Date(action.lastIncomingAt).getTime() > 24 * 3600_000 : true
  const sent = action.state === 'sent'
  const sending = action.state === 'sending'

  return (
    <div className="mt-3 max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate font-semibold">Messaggio a {action.name}</span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            sent ? 'bg-[#34C759]/15 text-[#34C759]' : action.state === 'error' ? 'bg-[#FF3B30]/15 text-[#FF3B30]' : 'bg-[var(--background)] text-[var(--text-secondary)]'
          }`}
        >
          {sent ? 'Inviato' : sending ? 'Invio…' : action.state === 'error' ? 'Non inviato' : 'Da inviare'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sent || sending}
        rows={3}
        className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] disabled:opacity-60 md:text-sm"
      />
      {old && !sent && <p className="mt-1 text-xs text-[#FF9500]">Ti ha scritto più di 24 ore fa: Meta potrebbe rifiutare l’invio.</p>}
      {action.error && <p className="mt-1 text-xs text-[#FF3B30]">{action.error}</p>}
      <div className="mt-3 flex justify-end">
        {sent ? (
          <span className="inline-flex items-center gap-1 text-xs text-[#34C759]">
            <Check className="h-3.5 w-3.5" /> Inviato
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              flush()
              onSend(text)
            }}
            disabled={sending || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invia
          </button>
        )}
      </div>
    </div>
  )
}
