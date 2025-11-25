'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Plus,
  Mic,
  User,
  Bot,
  Users,
  Link as LinkIcon,
  Copy,
  Check,
} from 'lucide-react'
import { Chat, Message } from '@/app/ai-chat/page'

interface AIChatMainProps {
  chat: Chat | null
  selectedModel: string
  isModelSelectorOpen: boolean
  onModelSelectorToggle: () => void
  onModelSelect: (model: string) => void
  onChatUpdate: (chat: Chat) => void
  onCreateGroupChat: (name: string) => Promise<void>
}

export default function AIChatMain({
  chat,
  selectedModel,
  isModelSelectorOpen,
  onModelSelectorToggle,
  onModelSelect,
  onChatUpdate,
  onCreateGroupChat,
}: AIChatMainProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showGroupChatDialog, setShowGroupChatDialog] = useState(false)
  const [groupChatName, setGroupChatName] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollToBottom()
  }, [chat?.messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    let updatedChat: Chat
    if (!chat) {
      // Create new chat if none exists
      updatedChat = {
        id: Date.now().toString(),
        title: input.trim().slice(0, 50),
        messages: [userMessage],
        createdAt: new Date(),
        updatedAt: new Date(),
        model: selectedModel,
      }
      // Notify parent to create chat
      onChatUpdate(updatedChat)
    } else {
      const updatedMessages = [...chat.messages, userMessage]
      updatedChat = {
        ...chat,
        messages: updatedMessages,
        title: chat.title === 'New Chat' ? input.trim().slice(0, 50) : chat.title,
        updatedAt: new Date(),
      }
      onChatUpdate(updatedChat)
    }

    setInput('')
    setIsLoading(true)

    try {
      const messagesToSend = updatedChat.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }))

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesToSend.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          model: selectedModel,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to get response`)
      }

      const data = await response.json()
      
      if (!data.message) {
        throw new Error(data.error || 'Empty response from AI')
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message,
        timestamp: new Date(),
      }

      const finalChat: Chat = {
        ...updatedChat,
        messages: [...updatedChat.messages, assistantMessage],
        updatedAt: new Date(),
      }

      onChatUpdate(finalChat)
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }
      const finalChat: Chat = {
        ...updatedChat,
        messages: [...updatedChat.messages, errorMessage],
        updatedAt: new Date(),
      }
      onChatUpdate(finalChat)
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

  const handleCreateGroupChat = async () => {
    if (groupChatName.trim()) {
      await onCreateGroupChat(groupChatName.trim())
      setShowGroupChatDialog(false)
      setGroupChatName('')
    }
  }

  const copyGroupLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col relative">
        {/* Top Bar */}
        <div className="p-3 sm:p-4 border-b border-coral-red/30 flex items-center justify-between glass-strong rounded-t-3xl backdrop-blur-xl">
          <button
            onClick={onModelSelectorToggle}
            className="px-3 py-2 sm:px-4 glass rounded-2xl hover:glass-strong transition-all text-xs sm:text-sm text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30"
          >
            <span className="font-medium">AI Model</span>
            <span className="text-xs text-coral-red/70 hidden sm:inline">
              {selectedModel === 'llama-3.1-8b-instant' ? 'Llama 3.1 8B' : 
               selectedModel === 'llama-3.3-70b-versatile' ? 'Llama 3.3 70B' :
               selectedModel === 'mixtral-8x7b-32768' ? 'Mixtral 8x7B' : selectedModel}
            </span>
          </button>
          <button
            onClick={() => setShowGroupChatDialog(true)}
            className="p-2 sm:px-4 sm:py-2 glass rounded-2xl hover:glass-strong transition-all text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30"
            title="Create Group Chat"
          >
            <Users className="w-4 h-4 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline text-sm">Create Group Chat</span>
          </button>
        </div>

        {/* Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="w-full max-w-5xl px-4 sm:px-6 mb-8 sm:mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center"
            >
              <h1 className="text-4xl sm:text-6xl md:text-8xl font-bold gradient-text mb-6 sm:mb-8">
                FacevoiceAI
              </h1>
            </motion.div>
          </div>

          {/* Center Search Bar */}
          <div className="w-full max-w-3xl px-4 sm:px-6">
            <div className="relative">
              <div className="relative glass-strong rounded-3xl border border-coral-red/40 focus-within:border-coral-red/60 transition-all shadow-xl backdrop-blur-xl">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Fai una domanda"
                  className="w-full px-12 sm:px-16 py-4 sm:py-5 bg-transparent rounded-3xl text-coral-red placeholder-coral-red/60 focus:outline-none resize-none max-h-40 overflow-y-auto text-sm sm:text-base"
                  rows={1}
                />
                <button className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 p-2 hover:glass rounded-full transition-all touch-manipulation">
                  <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-coral-red/70 hover:text-coral-red" />
                </button>
                <div className="absolute right-3 sm:right-4 top-1/2 transform -translate-y-1/2 flex items-center gap-1 sm:gap-2">
                  <button className="p-2 hover:glass rounded-full transition-all touch-manipulation hidden sm:block">
                    <Mic className="w-5 h-5 text-coral-red/70 hover:text-coral-red" />
                  </button>
                  <button className="p-2 hover:glass rounded-full transition-all touch-manipulation hidden sm:block">
                    <svg className="w-5 h-5 text-coral-red/70 hover:text-coral-red" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="p-2 sm:p-2 glass-strong rounded-full text-coral-red-light hover:border-coral-red border-2 border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                  >
                    <Send className="w-5 h-5 sm:w-5 sm:h-5" />
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col relative rounded-3xl overflow-hidden glass-strong border border-coral-red/30 shadow-2xl">
      {/* Header */}
      <div className="p-3 sm:p-5 border-b border-coral-red/30 flex items-center justify-between glass-strong rounded-t-3xl backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onModelSelectorToggle}
            className="px-3 py-2 sm:px-4 sm:py-2.5 glass rounded-2xl hover:glass-strong transition-all text-xs sm:text-sm text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30 touch-manipulation"
          >
            <span className="font-medium">AI Model</span>
            <span className="text-xs text-coral-red/70 hidden sm:inline">
              {selectedModel === 'llama-3.1-8b-instant' ? 'Llama 3.1 8B' : 
               selectedModel === 'llama-3.3-70b-versatile' ? 'Llama 3.3 70B' :
               selectedModel === 'mixtral-8x7b-32768' ? 'Mixtral 8x7B' : selectedModel}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGroupChatDialog(true)}
            className="p-2 sm:p-3 glass rounded-2xl hover:glass-strong transition-all border-2 border-transparent hover:border-coral-red/30 touch-manipulation"
            title="Create Group Chat"
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5 text-coral-red" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
        <AnimatePresence>
          {chat.messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass flex items-center justify-center flex-shrink-0 border-2 border-coral-red/20">
                  <Bot className="w-4 h-4 sm:w-6 sm:h-6 text-coral-red" />
                </div>
              )}
              <div
                className={`max-w-[85%] sm:max-w-[75%] glass-strong p-3 sm:p-5 rounded-2xl sm:rounded-3xl backdrop-blur-xl ${
                  message.role === 'user'
                    ? 'bg-coral-red/15 border border-coral-red/40'
                    : 'border border-coral-red/30'
                }`}
              >
                <p className="text-coral-red/90 leading-relaxed whitespace-pre-wrap text-sm sm:text-base">
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
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass flex items-center justify-center flex-shrink-0 border-2 border-coral-red/20">
                  <User className="w-4 h-4 sm:w-6 sm:h-6 text-coral-red" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-4"
          >
            <div className="w-10 h-10 rounded-full glass flex items-center justify-center border-2 border-coral-red/20">
              <Bot className="w-6 h-6 text-coral-red" />
            </div>
            <div className="glass-strong p-5 rounded-3xl border border-coral-red/30 backdrop-blur-xl">
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
      <div className="p-3 sm:p-6 border-t border-coral-red/30 glass-strong backdrop-blur-xl">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-2 sm:gap-4 items-end">
            <div className="flex-1 relative">
              <div className="relative glass-strong rounded-2xl sm:rounded-3xl border border-coral-red/40 focus-within:border-coral-red/60 transition-all shadow-xl backdrop-blur-xl">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Scrivi un messaggio..."
                  className="w-full px-10 sm:px-6 py-3 sm:py-4 bg-transparent rounded-2xl sm:rounded-3xl text-coral-red placeholder-coral-red/60 focus:outline-none resize-none max-h-40 overflow-y-auto text-sm sm:text-base"
                  rows={1}
                />
                <button className="absolute left-2 sm:left-4 top-1/2 transform -translate-y-1/2 p-2 hover:glass rounded-full transition-all touch-manipulation">
                  <Plus className="w-4 h-4 sm:w-5 sm:h-5 text-coral-red/70 hover:text-coral-red" />
                </button>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-3 sm:p-4 glass-strong rounded-2xl sm:rounded-3xl text-coral-red-light hover:border-coral-red border-2 border-coral-red/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg touch-manipulation flex-shrink-0"
            >
              <Send className="w-5 h-5 sm:w-6 sm:h-6" />
            </motion.button>
          </div>
          <p className="text-xs text-coral-red/50 mt-2 sm:mt-3 text-center hidden sm:block">
            L'AI può commettere errori. Verifica le informazioni importanti.
          </p>
        </div>
      </div>

      {/* Group Chat Dialog */}
      <AnimatePresence>
        {showGroupChatDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 glass-strong backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowGroupChatDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong p-6 rounded-2xl max-w-md w-full mx-4 border-2 border-coral-red/30"
            >
              <h3 className="text-xl font-bold text-coral-red-light mb-4">
                Create Group Chat
              </h3>
              <input
                type="text"
                value={groupChatName}
                onChange={(e) => setGroupChatName(e.target.value)}
                placeholder="Group chat name"
                className="w-full mb-4 px-4 py-2 glass rounded-lg text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateGroupChat()}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={handleCreateGroupChat}
                  className="flex-1 px-4 py-2 glass-strong rounded-lg text-coral-red hover:border-coral-red border-2 border-transparent transition-all"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowGroupChatDialog(false)
                    setGroupChatName('')
                  }}
                  className="px-4 py-2 glass rounded-lg text-coral-red"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

