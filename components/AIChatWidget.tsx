'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Bot, User, MessageCircle, Phone } from 'lucide-react'
import MessagingConversation from '@/components/ui/messaging-conversation'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Ciao! Sono l\'assistente AI di Facevoice AI. Posso aiutarti con informazioni sui nostri servizi AI, software, l\'importanza di avere un sito web e come collegarlo al tuo account Google. Come posso aiutarti?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showWhatsAppButton, setShowWhatsAppButton] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatWindowRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
    }
  }, [messages, isOpen])

  // Mostra il bottone WhatsApp dopo il primo messaggio dell'utente
  useEffect(() => {
    const userMessages = messages.filter(m => m.role === 'user')
    if (userMessages.length > 0) {
      setShowWhatsAppButton(true)
    }
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

    // Aggiungi il messaggio utente all'interfaccia immediatamente
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Prepara i messaggi da inviare (escluso il nuovo messaggio utente per evitare duplicati)
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

      if (!response.ok) {
        throw new Error('Errore nella risposta del server')
      }

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
    const phoneNumber = '+393514206353'
    const encodedMessage = encodeURIComponent(summary)
    const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${encodedMessage}`
    window.open(whatsappUrl, '_blank')
  }

  return (
    <>
      {/* Floating Button - Right side, just above nav bar */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-16 h-16 rounded-full bg-[var(--accent-blue)] text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center font-semibold text-lg"
      >
        {isOpen ? <X size={24} /> : 'AI'}
      </motion.button>

      {/* Chat Window - Right side, positioned above button */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            ref={chatWindowRef}
            className="fixed bottom-32 right-4 md:bottom-24 md:right-6 z-50 w-[calc(100vw-2rem)] md:w-96 max-w-md h-[calc(100vh-9rem)] md:h-[600px] max-h-[600px] bg-[var(--card-background)] rounded-2xl shadow-2xl border border-[var(--border-color)] flex flex-col overflow-hidden relative"
          >
            {/* Messages with MessagingConversation */}
            <div className="flex-1 overflow-hidden bg-[var(--background)] relative">
              <MessagingConversation
                messages={[
                  ...messages.map((msg) => ({
                    id: msg.id,
                    text: msg.content,
                    sender: {
                      id: msg.role === 'user' ? 'user-123' : 'assistant-456',
                      name: msg.role === 'user' ? 'You' : 'AI Assistant',
                      avatar: msg.role === 'user' 
                        ? 'https://api.dicebear.com/9.x/glass/svg?seed=you'
                        : 'https://api.dicebear.com/9.x/glass/svg?seed=ai',
                    },
                    time: msg.timestamp.toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })),
                  ...(isLoading ? [{
                    id: 'loading',
                    text: '...',
                    sender: {
                      id: 'assistant-456',
                      name: 'AI Assistant',
                      avatar: 'https://api.dicebear.com/9.x/glass/svg?seed=ai',
                    },
                    time: new Date().toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  }] : []),
                ]}
                otherUser={{
                  id: 'assistant-456',
                  name: 'AI Assistant',
                  avatar: 'https://api.dicebear.com/9.x/glass/svg?seed=ai',
                  status: 'online',
                }}
                className="h-full"
              />
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute bottom-4 left-4 flex gap-2 justify-start z-10"
                >
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)] flex items-center justify-center">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-[var(--background-secondary)] p-3 rounded-2xl">
                    <div className="flex gap-2">
                      <div className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce"
                        style={{ animationDelay: '0.2s' }}
                      />
                      <div
                        className="w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-bounce"
                        style={{ animationDelay: '0.4s' }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* WhatsApp Button */}
            {showWhatsAppButton && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--background-secondary)]"
              >
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleWhatsAppClick}
                  className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  <Phone className="w-5 h-5" />
                  <span>Contattaci su WhatsApp</span>
                </motion.button>
              </motion.div>
            )}

            {/* Input */}
            <div className="p-4 border-t border-[var(--border-color)] bg-[var(--background-secondary)]">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Scrivi un messaggio..."
                  className="flex-1 px-3 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] transition-all resize-none max-h-24 text-sm"
                  rows={1}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

