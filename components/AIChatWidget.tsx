'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Bot, Phone, Mail, Trash2, Bug } from 'lucide-react'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const WHATSAPP_NUMBER = '+393514206353'
const EMAIL_RECIPIENT = 'lucacorrao1996@gmail.com'
const INITIAL_MESSAGE = 'Ciao! Sono l\'assistente AI di Facevoice AI. Posso aiutarti con informazioni sui nostri servizi AI, software, l\'importanza di avere un sito web e come collegarlo al tuo account Google. Come posso aiutarti?'

export default function AIChatWidget() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: INITIAL_MESSAGE,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showWhatsAppButton, setShowWhatsAppButton] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Nascondi il widget nella pagina chat
  const isChatPage = pathname?.startsWith('/ai-chat')

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    // Auto-focus textarea when chat opens
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [messages, isOpen])

  useEffect(() => {
    const userMessages = messages.filter(m => m.role === 'user')
    setShowWhatsAppButton(userMessages.length > 0)
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const messageText = input.trim()
    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const messagesToSend = messages.map(m => ({
        role: m.role,
        content: m.content,
      }))
      
      const response = await fetch('/api/chat-widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesToSend,
          userMessage: messageText,
        }),
      })

      if (!response.ok) throw new Error('Errore nella risposta del server')

      const data = await response.json()
      
      const assistantMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.message || 'Mi dispiace, non sono riuscito a generare una risposta.',
        timestamp: new Date(),
      }
      
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error:', error)
      const errorMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'Mi dispiace, si è verificato un errore. Riprova più tardi o contattaci direttamente tramite WhatsApp.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input])

  const generateConversationSummary = () => {
    const userMessages = messages.filter(m => m.role === 'user')
    const assistantMessages = messages.filter(m => m.role === 'assistant')
    
    let summary = '📋 *Riassunto Conversazione Facevoice AI*\n\n'
    summary += `*Data:* ${new Date().toLocaleString('it-IT')}\n\n`
    summary += '*Messaggi Utente:*\n'
    userMessages.forEach((msg, idx) => {
      summary += `${idx + 1}. ${msg.content}\n`
    })
    summary += '\n*Risposte AI:*\n'
    assistantMessages.slice(1).forEach((msg, idx) => {
      summary += `${idx + 1}. ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n`
    })
    return summary
  }

  const handleWhatsAppClick = () => {
    const summary = generateConversationSummary()
    const encodedMessage = encodeURIComponent(summary)
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, '')}?text=${encodedMessage}`
    window.open(whatsappUrl, '_blank')
  }

  const handleDeleteChat = () => {
    if (confirm('Sei sicuro di voler cancellare questa conversazione?')) {
      setMessages([{
        id: 1,
        role: 'assistant',
        content: INITIAL_MESSAGE,
        timestamp: new Date(),
      }])
      setShowWhatsAppButton(false)
      setShowMenu(false)
    }
  }

  const handleSendEmail = async () => {
    try {
      const messagesToSend = messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      }))

      const response = await fetch('/api/chat-widget/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend }),
      })

      if (!response.ok) throw new Error('Errore nell\'invio dell\'email')

      alert(`Email inviata con successo! Riceverai il riassunto della conversazione a ${EMAIL_RECIPIENT}`)
      setShowMenu(false)
    } catch (error) {
      console.error('Error sending email:', error)
      alert('Si è verificato un errore nell\'invio dell\'email. Riprova più tardi.')
    }
  }

  const handleReportBug = () => {
    const bugMessage = `🐛 *Segnalazione Bug - Assistente AI Facevoice AI*\n\n` +
      `*Data:* ${new Date().toLocaleString('it-IT')}\n\n` +
      `*Descrizione del Bug:*\n` +
      `[Descrivi qui il bug che hai riscontrato]\n\n` +
      `*Dettagli Tecnici:*\n` +
      `- Dispositivo: ${navigator.userAgent.includes('iPhone') ? 'iPhone' : navigator.userAgent.includes('Android') ? 'Android' : 'Desktop'}\n` +
      `- Browser: ${navigator.userAgent}\n` +
      `- Timestamp: ${new Date().toISOString()}\n\n` +
      `_Grazie per la segnalazione!_`
    
    const encodedMessage = encodeURIComponent(bugMessage)
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, '')}?text=${encodedMessage}`
    window.open(whatsappUrl, '_blank')
    setShowMenu(false)
  }

  // Non mostrare il widget nella pagina chat
  if (isChatPage) {
    return null
  }

  return (
    <>
      {/* Floating Button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-16 h-16 rounded-full bg-[var(--accent-blue)] text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center font-semibold text-lg"
        aria-label={isOpen ? 'Chiudi chat' : 'Apri chat AI'}
      >
        {isOpen ? <X size={24} /> : 'AI'}
      </motion.button>

      {/* Overlay */}
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

      {/* Chat Window - Sempre centrata e completamente visibile su mobile */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-[60] 
              right-4 left-auto
              md:left-1/2 md:-translate-x-1/2 md:right-auto
              top-[2.5vh] bottom-[100px]
              md:top-[30%] md:bottom-auto
              w-[calc(100vw-2rem)] max-w-[500px]
              md:w-[500px]
              h-auto
              md:h-[700px] md:max-h-[700px]
              flex flex-col bg-[var(--card-background)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] bg-[var(--background-secondary)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--text-primary)]">AI Assistant</h3>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs text-[var(--text-secondary)]">online</span>
                  </div>
                </div>
              </div>
              
              {/* Menu Button */}
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 hover:bg-[var(--background)] rounded-lg transition-colors"
                  aria-label="Menu opzioni"
                >
                  <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
                
                {/* Menu Dropdown */}
                {showMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-10 overflow-hidden">
                    <button
                      onClick={handleDeleteChat}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left text-red-600 hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="text-sm">Cancella chat</span>
                    </button>
                    <button
                      onClick={handleSendEmail}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left text-blue-600 hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">Invia email</span>
                    </button>
                    <button
                      onClick={handleReportBug}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left text-yellow-600 hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      <Bug className="w-4 h-4" />
                      <span className="text-sm">Segnala un bug</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--background)]">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {msg.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-[var(--accent-blue)]">Tu</span>
                    </div>
                  )}
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-[var(--background-secondary)] rounded-2xl px-4 py-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                      <div className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* WhatsApp Button */}
            {showWhatsAppButton && (
              <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--background-secondary)]">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleWhatsAppClick}
                  className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors font-medium text-sm"
                >
                  <Phone className="w-4 h-4" />
                  <span>Contattaci su WhatsApp</span>
                </motion.button>
              </div>
            )}

            {/* Input Area */}
            <div className="p-4 border-t border-[var(--border-color)] bg-[var(--background-secondary)]">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Scrivi un messaggio..."
                  className="flex-1 px-3 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all resize-none max-h-24 text-sm"
                  rows={1}
                  disabled={isLoading}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Invia messaggio"
                >
                  <Send className="w-5 h-5" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
