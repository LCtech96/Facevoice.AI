'use client'

import { useState } from 'react'
import { Bell, CalendarClock, Check, ChevronDown, Copy, Facebook, FilePenLine, FileText, Images, Instagram, KeyRound, Loader2, Mail, Newspaper, Send, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import { authFetch, type ConfirmAction } from '@/components/useAssistantChat'
import { PIN_PATTERN } from '@/lib/contract-text'
import { useSyncedText } from './useSyncedText'

// Doppia conferma: l'assistente ha preparato un'azione che esce dalla chat (messaggio,
// email, pubblicazione, blog automatico, cancellazione, invio di un documento). Qui si
// vede il contenuto esatto; parte solo con "Accetta e invia" (o "Conferma"/"Pubblica"),
// "Scarta" la chiude e l'assistente chiede cosa serve davvero. Il server esegue una
// volta sola: un secondo clic o un'altra scheda aperta ricevono l'esito, non un doppio invio.

const API = '/api/admin/assistant/actions'

type Patch = Partial<ConfirmAction>

const DONE_LABEL: Record<string, string> = {
  social_message: 'Inviato',
  send_emails: 'Inviate',
  send_document: 'Inviato',
  share_contract: 'Fatto',
  publish_carousel: 'Pubblicato',
  schedule_video: 'Programmato',
  schedule_carousel: 'Programmato',
  publish_blog_now: 'Avviato',
}

function iconFor(action: ConfirmAction) {
  if (action.action === 'social_message') return /Facebook/.test(action.title) ? Facebook : Instagram
  if (action.action === 'send_emails') return Mail
  if (action.action === 'send_document') return FileText
  if (action.action === 'share_contract') return FilePenLine
  if (action.action === 'publish_carousel') return Send
  if (action.action === 'schedule_video' || action.action === 'schedule_carousel') return CalendarClock
  if (action.action === 'photo_autopilot') return Images
  if (action.action === 'publish_blog_now') return Newspaper
  if (action.action === 'remove_push_devices') return Bell
  if (action.action === 'clear_content_directions') return Trash2
  return Settings2
}

export default function ConfirmCard({
  action,
  canConfirm,
  onUpdate,
  onDiscarded,
}: {
  action: ConfirmAction
  /** Solo l'amministratore conferma (come il server). */
  canConfirm: boolean
  onUpdate: (patch: Patch) => unknown
  /** Dopo "Scarta": l'assistente chiede in chat cosa serve davvero. */
  onDiscarded?: (title: string) => void
}) {
  const [text, setText, flush] = useSyncedText(action.text ?? '', (value) => onUpdate({ text: value }))
  const [busy, setBusy] = useState<'accept' | 'discard' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  // Contratti: PIN scelto qui, nascosto. Resta solo in questa scheda fino al clic: non va
  // nella chat, non va all'AI e non si salva (al server arriva solo per farne l'hash).
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const pinOk = !action.pin || (PIN_PATTERN.test(pin) && pin.toUpperCase() === pin2.toUpperCase())
  const Icon = iconFor(action)

  const expired = action.state === 'pending' && Date.now() > new Date(action.expiresAt).getTime()
  const state = expired ? 'expired' : action.state
  const actionable = state === 'pending' || (state === 'failed' && action.retryable)
  const editing = Boolean(action.editable) && actionable && canConfirm

  const decide = async (decision: 'accept' | 'discard') => {
    if (busy) return
    setBusy(decision)
    setMessage(null)
    if (decision === 'accept') await flush()
    const res = await authFetch(API, {
      method: 'POST',
      body: JSON.stringify({ id: action.id, decision, ...(decision === 'accept' && action.editable ? { text } : {}), ...(decision === 'accept' && action.pin ? { pin } : {}) }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (data?.card?.state === 'done' || decision === 'discard') {
      setPin('')
      setPin2('')
    }
    if (data?.card) {
      const card = data.card as ConfirmAction
      onUpdate({ state: card.state, outcome: card.outcome, error: card.error, retryable: card.retryable, ...(action.editable && card.text !== undefined ? { text: card.text } : {}) })
    }
    if (!res?.ok || data?.ok === false) {
      setMessage(data?.message || data?.error || (res ? 'Operazione non riuscita, riprova.' : 'Connessione interrotta: controlla la scheda prima di riprovare.'))
      return
    }
    if (decision === 'discard') onDiscarded?.(action.title)
  }

  const copyLink = async () => {
    if (!action.contractId) return
    setCopied(null)
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(action.contractId)}?link=1`).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    const link = data?.contract?.link
    if (!link) return setCopied('Nessun link attivo: crealo di nuovo dalla pagina del contratto.')
    try {
      await navigator.clipboard.writeText(link)
      setCopied('Link copiato. Ricorda: il PIN mandalo a parte.')
    } catch {
      setCopied(link)
    }
  }

  const badge =
    state === 'done'
      ? { text: `${DONE_LABEL[action.action] || 'Fatto'} ✓`, cls: 'bg-[#34C759]/15 text-[#34C759]' }
      : state === 'failed'
        ? { text: 'Non riuscito', cls: 'bg-[#FF3B30]/15 text-[#FF3B30]' }
        : state === 'discarded'
          ? { text: 'Scartato', cls: 'bg-[var(--background)] text-[var(--text-secondary)]' }
          : state === 'expired'
            ? { text: 'Scaduto', cls: 'bg-[var(--background)] text-[var(--text-secondary)]' }
            : state === 'unknown'
              ? { text: 'Esito incerto', cls: 'bg-[#FF9500]/15 text-[#FF9500]' }
              : state === 'running' || busy === 'accept'
                ? { text: 'In corso…', cls: 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' }
                : { text: 'Da confermare', cls: 'bg-[#FF9500]/15 text-[#FF9500]' }

  return (
    <div className="mt-3 w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="flex items-start justify-between gap-2 text-sm">
        <span className="inline-flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words font-semibold">{action.title}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
      </div>

      {action.images?.length ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {action.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`Slide ${i + 1}`} className="h-20 w-16 shrink-0 rounded-md object-cover" />
          ))}
        </div>
      ) : null}

      {action.text !== undefined &&
        (editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={Boolean(busy)}
            maxLength={action.maxLength}
            rows={Math.min(10, Math.max(3, Math.ceil(text.length / 60)))}
            aria-label="Testo da inviare"
            className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] disabled:opacity-60 md:text-sm"
          />
        ) : (
          <p className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)]">{action.text}</p>
        ))}

      {action.lines?.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
          {action.lines.map((line, i) => (
            <li key={i} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {action.items?.length ? (
        <div className="mt-2 divide-y divide-[var(--border-color)] rounded-lg border border-[var(--border-color)] bg-[var(--background)]">
          {action.items.map((item, i) => (
            <div key={i}>
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex min-h-[40px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)]"
              >
                <span className="min-w-0 break-words">{item.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
              </button>
              {open === i && <p className="whitespace-pre-wrap break-words px-3 pb-3 text-xs text-[var(--text-secondary)]">{item.text}</p>}
            </div>
          ))}
        </div>
      ) : null}

      {action.pin && actionable && canConfirm && (
        <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <KeyRound className="h-3.5 w-3.5" /> PIN per aprire il link
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={12}
              placeholder="PIN (4-12 lettere o numeri)"
              aria-label="PIN"
              disabled={Boolean(busy)}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-base text-[var(--text-primary)] md:text-sm"
            />
            <input
              type="password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={12}
              placeholder="Ripeti il PIN"
              aria-label="Ripeti il PIN"
              disabled={Boolean(busy)}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-base text-[var(--text-primary)] md:text-sm"
            />
          </div>
          {pin2 && !pinOk && <p className="mt-1 text-xs text-[#FF3B30]">{PIN_PATTERN.test(pin) ? 'I due PIN non sono uguali.' : 'Da 4 a 12 lettere o numeri.'}</p>}
          <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">Il PIN non è nel messaggio e non resta in chat: mandalo a parte (a voce, SMS o telefonata).</p>
        </div>
      )}

      {action.warning && actionable && <p className="mt-2 text-xs text-[#FF9500]">{action.warning}</p>}
      {state === 'done' && action.outcome && <p className="mt-2 text-xs text-[#34C759]">Fatto: {action.outcome}</p>}
      {state === 'done' && action.contractId && canConfirm && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyLink} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
            <Copy className="h-3.5 w-3.5" /> Copia link
          </button>
          <a href={`/admin/contratti/${encodeURIComponent(action.contractId)}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
            <FilePenLine className="h-3.5 w-3.5" /> Apri contratto
          </a>
          {copied && <span className="break-all text-xs text-[var(--text-secondary)]">{copied}</span>}
        </div>
      )}
      {state === 'failed' && action.error && <p className="mt-2 text-xs text-[#FF3B30]">{action.error}</p>}
      {state === 'expired' && <p className="mt-2 text-xs text-[var(--text-secondary)]">Non è partito niente. Se ti serve ancora, chiedilo di nuovo all’assistente.</p>}
      {state === 'unknown' && <p className="mt-2 text-xs text-[#FF9500]">L’invio si è interrotto a metà: controlla se è partito prima di rifarlo.</p>}
      {message && <p className="mt-2 text-xs text-[#FF3B30]">{message}</p>}

      {actionable &&
        (canConfirm ? (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <ShieldCheck className="h-3.5 w-3.5" /> Parte solo con il tuo clic
            </span>
            <button
              type="button"
              onClick={() => decide('discard')}
              disabled={Boolean(busy)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
            >
              {busy === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Scarta
            </button>
            <button
              type="button"
              onClick={() => decide('accept')}
              disabled={Boolean(busy) || (editing && !text.trim()) || !pinOk}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {state === 'failed' ? 'Riprova' : action.confirmLabel}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Solo l’amministratore può confermare o scartare.</p>
        ))}
    </div>
  )
}
