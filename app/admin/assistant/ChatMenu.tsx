'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, History, Loader2, MessageSquare } from 'lucide-react'
import type { ChatInfo, PutResult } from '@/components/useAssistantChat'
import { shortDate } from './format'

// Chat salvate della super chat: con "Nuova chat" quella di prima non si perde,
// si ritrova qui e si riapre con un tocco. Si cambia chat solo a lavoro fermo.

export default function ChatMenu({
  busy,
  onList,
  onOpen,
}: {
  busy: boolean
  onList: () => Promise<ChatInfo[] | null>
  onOpen: (id: string) => Promise<PutResult>
}) {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState<ChatInfo[] | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Si chiude toccando fuori o con Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async () => {
    if (open) return setOpen(false)
    setOpen(true)
    setError(null)
    setChats(null)
    const list = await onList()
    if (list) setChats(list)
    else {
      setChats([])
      setError('Elenco delle chat non disponibile, riprova.')
    }
  }

  const choose = async (chat: ChatInfo) => {
    if (chat.current || !chat.id || busy || opening) return
    setOpening(chat.id)
    setError(null)
    const result = await onOpen(chat.id)
    setOpening(null)
    if (result.ok) setOpen(false)
    else setError(result.error || 'Chat non aperta, riprova.')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Chat salvate"
        aria-expanded={open}
        title="Chat salvate"
        className="flex items-center gap-1.5 p-1 text-sm text-[var(--text-secondary)] sm:p-0"
      >
        <History className="h-5 w-5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Chat</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--background)] text-[var(--text-primary)] shadow-xl">
          <p className="px-4 pb-2 pt-3 text-xs font-semibold text-[var(--text-secondary)]">Chat salvate</p>
          <div className="max-h-[min(60vh,26rem)] overflow-y-auto">
            {chats === null ? (
              <p className="flex items-center gap-2 border-t border-[var(--border-color)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Carico le chat…
              </p>
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.id || 'current'}
                  type="button"
                  onClick={() => choose(chat)}
                  disabled={!chat.current && (busy || opening !== null)}
                  className="flex w-full items-start gap-3 border-t border-[var(--border-color)] px-4 py-3 text-left text-sm hover:bg-[var(--background-secondary)] disabled:opacity-50"
                >
                  {opening === chat.id ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent-blue)]" />
                  ) : chat.current ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                  ) : (
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{chat.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {chat.current ? 'Aperta ora' : shortDate(chat.updatedAt)} · {chat.count} {chat.count === 1 ? 'messaggio' : 'messaggi'}
                    </span>
                  </span>
                </button>
              ))
            )}
            {chats !== null && chats.length <= 1 && !error && (
              <p className="border-t border-[var(--border-color)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                Con «Nuova chat» questa conversazione resta salvata qui.
              </p>
            )}
          </div>
          {busy && <p className="border-t border-[var(--border-color)] px-4 py-2 text-xs text-[#FF9500]">Aspetta che finisca il lavoro in corso per cambiare chat.</p>}
          {error && <p className="border-t border-[var(--border-color)] px-4 py-2 text-xs text-[#FF3B30]">{error}</p>}
        </div>
      )}
    </div>
  )
}
