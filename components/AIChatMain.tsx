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
        <div className="p-4 border-b border-coral-red/20 flex items-center justify-between glass-strong rounded-t-3xl">
          <button
            onClick={onModelSelectorToggle}
            className="px-4 py-2 glass rounded-2xl hover:glass-strong transition-all text-sm text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30"
          >
            <span className="font-medium">ChatGPT</span>
            <span className="text-xs text-coral-red/70">
              {selectedModel === 'llama-3.1-70b-versatile' ? 'Groq (Llama 3.1 70B)' : selectedModel}
            </span>
          </button>
          <button
            onClick={() => setShowGroupChatDialog(true)}
            className="px-4 py-2 glass rounded-2xl hover:glass-strong transition-all text-sm text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30"
            title="Create Group Chat"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">Create Group Chat</span>
          </button>
        </div>

        {/* Center Search Bar */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-3xl">
            <h2 className="text-3xl font-bold text-coral-red-light mb-8 text-center">
              How can I help you today?
            </h2>
            <div className="relative">
              <div className="relative glass-strong rounded-3xl border-2 border-coral-red/30 focus-within:border-coral-red/60 transition-all shadow-lg">
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
                  placeholder="Ask a question"
                  className="w-full px-16 py-5 bg-transparent rounded-3xl text-coral-red placeholder-coral-red/60 focus:outline-none resize-none max-h-40 overflow-y-auto text-base"
                  rows={1}
                />
                <button className="absolute left-4 top-1/2 transform -translate-y-1/2 p-2 hover:glass rounded-full transition-all">
                  <Plus className="w-6 h-6 text-coral-red/70 hover:text-coral-red" />
                </button>
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                  <button className="p-2 hover:glass rounded-full transition-all">
                    <Mic className="w-5 h-5 text-coral-red/70 hover:text-coral-red" />
                  </button>
                  <button className="p-2 hover:glass rounded-full transition-all">
                    <svg className="w-5 h-5 text-coral-red/70 hover:text-coral-red" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="p-2 glass-strong rounded-full text-coral-red-light hover:border-coral-red border-2 border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
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
    <div className="flex-1 flex flex-col relative rounded-3xl overflow-hidden glass-strong border-2 border-coral-red/20">
      {/* Header */}
      <div className="p-5 border-b border-coral-red/20 flex items-center justify-between glass-strong rounded-t-3xl">
        <div className="flex items-center gap-3">
          <button
            onClick={onModelSelectorToggle}
            className="px-4 py-2.5 glass rounded-2xl hover:glass-strong transition-all text-sm text-coral-red flex items-center gap-2 border-2 border-transparent hover:border-coral-red/30"
          >
                    <span className="font-medium">ChatGPT</span>
                    <span className="text-xs text-coral-red/70">
                      {selectedModel === 'llama-3.1-8b-instant' ? 'Groq (Llama 3.1 8B)' : 
                       selectedModel === 'llama-3.3-70b-versatile' ? 'Groq (Llama 3.3 70B)' :
                       selectedModel === 'mixtral-8x7b-32768' ? 'Groq (Mixtral 8x7B)' : selectedModel}
                    </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGroupChatDialog(true)}
            className="p-3 glass rounded-2xl hover:glass-strong transition-all border-2 border-transparent hover:border-coral-red/30"
            title="Create Group Chat"
          >
            <Users className="w-5 h-5 text-coral-red" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
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
                <div className="w-10 h-10 rounded-full glass flex items-center justify-center flex-shrink-0 border-2 border-coral-red/20">
                  <Bot className="w-6 h-6 text-coral-red" />
                </div>
              )}
              <div
                className={`max-w-[75%] glass-strong p-5 rounded-3xl ${
                  message.role === 'user'
                    ? 'bg-coral-red/20 border-2 border-coral-red/30'
                    : 'border-2 border-coral-red/20'
                }`}
              >
                <p className="text-coral-red/90 leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </p>
                <p className="text-xs text-coral-red/50 mt-2">
                  {message.timestamp.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              {message.role === 'user' && (
                <div className="w-10 h-10 rounded-full glass flex items-center justify-center flex-shrink-0 border-2 border-coral-red/20">
                  <User className="w-6 h-6 text-coral-red" />
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
            <div className="glass-strong p-5 rounded-3xl border-2 border-coral-red/20">
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
      <div className="p-6 border-t border-coral-red/20 glass-strong">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-4 items-end">
            <div className="flex-1 relative">
              <div className="relative glass-strong rounded-3xl border-2 border-coral-red/30 focus-within:border-coral-red/60 transition-all shadow-lg">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Send a message or @ChatGPT"
                  className="w-full px-6 py-4 bg-transparent rounded-3xl text-coral-red placeholder-coral-red/60 focus:outline-none resize-none max-h-40 overflow-y-auto text-base"
                  rows={1}
                />
                <button className="absolute left-4 top-1/2 transform -translate-y-1/2 p-2 hover:glass rounded-full transition-all">
                  <Plus className="w-5 h-5 text-coral-red/70 hover:text-coral-red" />
                </button>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-4 glass-strong rounded-3xl text-coral-red-light hover:border-coral-red border-2 border-coral-red/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              <Send className="w-6 h-6" />
            </motion.button>
          </div>
          <p className="text-xs text-coral-red/50 mt-3 text-center">
            ChatGPT can make mistakes. Check important info.
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

