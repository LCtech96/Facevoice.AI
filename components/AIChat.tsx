'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Bot, User } from 'lucide-react'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface AIChatProps {
  onClose: () => void
}

export default function AIChat({ onClose }: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Ciao! Sono l\'assistente AI di Facevoice AI. Come posso aiutarti oggi?',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Simulate AI response (in production, replace with actual API call)
    setTimeout(() => {
      const assistantMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Grazie per il tuo messaggio: "${userMessage.content}". Questo è un esempio di risposta. In produzione, questa sarà connessa a un vero LLM API.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 1000)
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-screen pt-24 px-6 pb-6">
      <div className="container mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-strong rounded-2xl overflow-hidden flex flex-col h-[calc(100vh-8rem)]"
        >
          {/* Header */}
          <div className="p-6 border-b border-coral-red/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full glass flex items-center justify-center">
                <Bot className="w-6 h-6 text-coral-red" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-coral-red-light">
                  AI Chat Assistant
                </h2>
                <p className="text-sm text-coral-red/70">Powered by Facevoice AI</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 glass rounded-lg hover:glass-strong transition-all"
            >
              <X className="w-5 h-5 text-coral-red" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <AnimatePresence>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex gap-3 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full glass flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-coral-red" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] glass-strong p-4 rounded-2xl ${
                      message.role === 'user'
                        ? 'bg-coral-red/20 border-coral-red/30'
                        : ''
                    }`}
                  >
                    <p className="text-coral-red/90 leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                    <p className="text-xs text-coral-red/50 mt-2">
                      {message.timestamp.toLocaleTimeString('it-IT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full glass flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-coral-red" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-full glass flex items-center justify-center">
                  <Bot className="w-5 h-5 text-coral-red" />
                </div>
                <div className="glass-strong p-4 rounded-2xl">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-coral-red rounded-full animate-bounce" />
                    <div
                      className="w-2 h-2 bg-coral-red rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <div
                      className="w-2 h-2 bg-coral-red rounded-full animate-bounce"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-6 border-t border-coral-red/20">
            <div className="flex gap-3 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Scrivi un messaggio..."
                className="flex-1 px-4 py-3 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent transition-all resize-none max-h-32"
                rows={1}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="p-3 glass-strong rounded-lg text-coral-red-light hover:border-coral-red border-2 border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </motion.button>
            </div>
            <p className="text-xs text-coral-red/50 mt-2 text-center">
              Premi Invio per inviare, Maiusc+Invio per andare a capo
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

