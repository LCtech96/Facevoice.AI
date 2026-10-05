'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Bot, Trash2, UserRound } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Chat pubblica del sito. Ogni visitatore ha una sessione (id casuale in
// localStorage): i messaggi finiscono nella casella Messaggi dell'admin
// (canale "Chat sito"). L'AI raccoglie esigenza e contatto a piccoli passi,
// poi passa la conversazione a un operatore, le cui risposte arrivano qui.

type ChatMessage = { id: string; direction: 'in' | 'out'; body: string; created_at: string }

const TEASER_KEY = 'fv_chat_teaser_closed'
// Testo del fumetto nella lingua scelta sul sito (inglese per le altre lingue).
const TEASER_TEXT: Record<string, { question: string; cta: string }> = {
  it: { question: 'Vuoi sapere in breve di cosa ci occupiamo e come possiamo aiutarti?', cta: 'Scrivici qui' },
  en: { question: 'Want to know in short what we do and how we can help you?', cta: 'Write to us here' },
}
const SESSION_KEY = 'fv_site_chat_session'
const POLL_OPEN_MS = 4000
const POLL_HANDOFF_MS = 3000
const INITIAL_MESSAGE = 'Ciao! 👋 Sono l’assistente di Facevoice AI. Come posso aiutarti?'

function newSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Navigazione privata: la chat funziona lo stesso, solo senza memoria.
  }
}

export default function AIChatWidget() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [session, setSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [handoff, setHandoff] = useState(false)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [showMenu, setShowMenu] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSyncRef = useRef<string | undefined>(undefined)
  const openRef = useRef(false)

  const isChatPage = pathname?.startsWith('/ai-chat')
  const hidden = isChatPage || pathname?.startsWith('/admin')

  useEffect(() => {
    openRef.current = isOpen
    if (isOpen) setUnread(0)
  }, [isOpen])

  // Fumetto che invita a scrivere: compare dopo un attimo, sparisce quando si apre
  // la chat o si chiude con la X (e non torna per tutta la visita).
  const [teaser, setTeaser] = useState(false)
  const { language } = useTranslation()
  const teaserText = TEASER_TEXT[language] || TEASER_TEXT.en
  useEffect(() => {
    let closed = false
    try {
      closed = sessionStorage.getItem(TEASER_KEY) === '1'
    } catch {}
    if (closed) return
    const timer = setTimeout(() => setTeaser(true), 1500)
    return () => clearTimeout(timer)
  }, [])
  const hideTeaser = useCallback(() => {
    setTeaser(false)
    try {
      sessionStorage.setItem(TEASER_KEY, '1')
    } catch {}
  }, [])
  useEffect(() => {
    if (isOpen) hideTeaser()
  }, [isOpen, hideTeaser])

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id))
      const added = incoming.filter((m) => !known.has(m.id))
      if (!added.length) return prev
      const outgoingAdded = added.filter((m) => m.direction === 'out').length
      if (!openRef.current && outgoingAdded) setUnread((n) => n + outgoingAdded)
      return [...prev, ...added].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
    lastSyncRef.current = incoming[incoming.length - 1].created_at
  }, [])

  const sync = useCallback(
    async (id: string, full = false) => {
      const after = full ? '' : lastSyncRef.current ? `&after=${encodeURIComponent(lastSyncRef.current)}` : ''
      const res = await fetch(`/api/site-chat?session=${encodeURIComponent(id)}${after}`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json().catch(() => null)
      if (!data) return
      merge(data.messages || [])
      setHandoff(Boolean(data.handoff))
    },
    [merge]
  )

  // Riprende la conversazione dopo un ricaricamento della pagina.
  useEffect(() => {
    if (hidden) return
    const saved = readSession()
    if (saved) {
      setSession(saved)
      sync(saved, true)
    }
  }, [hidden, sync])

  // Aggiornamento periodico: serve per le risposte dell'operatore.
  useEffect(() => {
    if (!session || hidden) return
    const interval = handoff ? POLL_HANDOFF_MS : POLL_OPEN_MS
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (!openRef.current && !handoff) return
      sync(session)
    }, interval)
    return () => clearInterval(id)
  }, [session, handoff, hidden, sync])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, isLoading, isOpen])

  useEffect(() => {
    if (isOpen) setTimeout(() => textareaRef.current?.focus(), 100)
  }, [isOpen])

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [input])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    let id = session
    if (!id) {
      id = newSessionId()
      setSession(id)
      writeSession(id)
    }

    const local: ChatMessage = { id: `local-${Date.now()}`, direction: 'in', body: text, created_at: new Date().toISOString() }
    const history = messages.map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body }))
    setMessages((prev) => [...prev, local])
    setInput('')
    setError(null)
    setIsLoading(!handoff)

    try {
      const res = await fetch('/api/site-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: id, text, history, language }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Invio non riuscito')
      if (data.handoff) setHandoff(true)
      // Sostituisce il messaggio locale con quelli salvati (stessi id del server).
      if (data.stored) {
        setMessages((prev) => prev.filter((m) => m.id !== local.id))
        lastSyncRef.current = undefined
        await sync(id, true)
      } else if (data.reply) {
        merge([data.reply])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invio non riuscito, riprova.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewChat = () => {
    if (!confirm('Vuoi iniziare una nuova conversazione?')) return
    writeSession(null)
    setSession(null)
    setMessages([])
    setHandoff(false)
    lastSyncRef.current = undefined
    setShowMenu(false)
  }

  if (hidden) return null

  const visible: ChatMessage[] = [
    { id: 'welcome', direction: 'out', body: INITIAL_MESSAGE, created_at: '' },
    ...messages,
  ]

  return (
    <div className="ember-vars">
      {/* Invito a scrivere, con freccia verso il pulsante */}
      <AnimatePresence>
        {teaser && !isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3 }}
            className="fixed z-50 right-4 bottom-[188px] md:right-6 md:bottom-[132px] w-[min(280px,calc(100vw-2rem))]"
          >
            <div className="relative rounded-2xl border border-white/15 bg-[#24100a]/95 backdrop-blur px-4 py-3 pr-9 shadow-2xl">
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="text-left text-sm leading-snug text-white/85"
              >
                {teaserText.question}
                <span className="block mt-1 font-semibold text-[#ff8a1f]">{teaserText.cta}</span>
              </button>
              <button
                type="button"
                onClick={hideTeaser}
                className="absolute top-2 right-2 p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10"
                aria-label="Chiudi suggerimento"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Freccia che punta al pulsante AI */}
            <motion.svg
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -bottom-[46px] right-[14px] w-9 h-11 text-[#ff8a1f]"
              viewBox="0 0 36 44"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3 C 6 18, 12 30, 20 38" />
              <path d="M11 36 L 20 38 L 21 29" />
            </motion.svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pulsante flottante */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-16 h-16 rounded-full bg-[var(--accent-blue)] text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center font-semibold text-lg"
        aria-label={isOpen ? 'Chiudi chat' : 'Apri chat'}
      >
        {isOpen ? <X size={24} /> : <span translate="no">AI</span>}
        {!isOpen && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-white text-[#c2410c] text-xs font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 pointer-events-auto"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-[60] right-4 left-auto md:left-1/2 md:-translate-x-1/2 md:right-auto top-[2.5vh] bottom-[100px] md:top-24 md:bottom-24 w-[calc(100vw-2rem)] max-w-[500px] md:w-[500px] h-auto flex flex-col bg-[#1a0702] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Intestazione */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ff3d00] to-[#ff8a1f] flex items-center justify-center">
                  {handoff ? <UserRound className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{handoff ? 'Team Facevoice AI' : 'Assistente Facevoice AI'}</h3>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${handoff ? 'bg-[#ff8a1f]' : 'bg-green-500'}`} />
                    <span className="text-xs text-white/60">{handoff ? 'Operatore in arrivo' : 'online'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Opzioni"
                  >
                    <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-[#24100a] border border-[var(--border-color)] rounded-lg shadow-xl z-10 overflow-hidden">
                      <button
                        onClick={handleNewChat}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-white/85 hover:bg-white/5 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-sm">Nuova conversazione</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
                {/* Chiude la finestra: la conversazione resta e si riprende riaprendo la chat. */}
                <button
                  onClick={() => {
                    setShowMenu(false)
                    setIsOpen(false)
                  }}
                  className="p-2 -mr-1 hover:bg-white/10 rounded-lg transition-colors"
                  aria-label="Chiudi chat"
                  title="Chiudi"
                >
                  <X className="w-5 h-5 text-white/80" />
                </button>
              </div>
            </div>

            {/* Messaggi */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {visible.map((msg) => {
                const mine = msg.direction === 'in'
                return (
                  <div key={msg.id} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                        mine ? 'bg-gradient-to-r from-[#ff3d00] to-[#ff8a1f] text-white' : 'bg-white/10 text-white'
                      }`}
                    >
                      {/* Quello che scrive il visitatore resta com'e'; i nostri messaggi (anche le
                          risposte a mano dell'operatore) seguono la lingua scelta sul sito. */}
                      <p
                        className="text-sm leading-relaxed whitespace-pre-wrap"
                        {...(mine ? { 'data-no-translate': '' } : {})}
                      >
                        {msg.body}
                      </p>
                      {msg.created_at && (
                        <p className="text-[10px] opacity-60 mt-1">
                          {new Date(msg.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/10 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-[#ff8a1f] rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-[#ff8a1f] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="w-2 h-2 bg-[#ff8a1f] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </div>
              )}

              {handoff && (
                <p className="text-center text-xs text-[#ffb27a] px-4">
                  Un operatore del team ti risponderà qui a breve. Non chiudere la chat.
                </p>
              )}
              {error && <p className="text-center text-xs text-red-400">{error}</p>}
            </div>

            {/* Scrittura */}
            <div className="p-4 border-t border-[var(--border-color)]">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Scrivi un messaggio..."
                  className="flex-1 px-3 py-2 bg-black/30 border border-[var(--border-color)] rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-[#ff8a1f] transition-all resize-none max-h-24 text-[16px] md:text-sm"
                  rows={1}
                  maxLength={1000}
                  disabled={isLoading}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 bg-gradient-to-r from-[#ff3d00] to-[#ff8a1f] text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Invia messaggio"
                >
                  <Send className="w-5 h-5" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
