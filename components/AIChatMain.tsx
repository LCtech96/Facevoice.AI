'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Plus,
  User,
  Bot,
  Sparkles,
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
      updatedChat = {
        id: Date.now().toString(),
        title: input.trim().slice(0, 50),
        messages: [userMessage],
        createdAt: new Date(),
        updatedAt: new Date(),
        model: selectedModel,
      }
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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedChat.messages.map((msg) => ({
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

  const getModelName = () => {
    if (selectedModel === 'llama-3.1-8b-instant') return 'Llama 3.1 8B'
    if (selectedModel === 'llama-3.3-70b-versatile') return 'Llama 3.3 70B'
    if (selectedModel === 'mixtral-8x7b-32768') return 'Mixtral 8x7B'
    return selectedModel
  }

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--background)]">
        {/* Empty State - ChatGPT Style */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-3xl mx-auto w-full">
          <div className="mb-8">
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] mb-2 text-center">
              FacevoiceAI
            </h1>
            <p className="text-[var(--text-secondary)] text-center">
              How can I help you today?
            </p>
          </div>

          {/* Quick suggestions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full mb-8">
            {[
              'Explain quantum computing',
              'Write a creative story',
              'Plan a trip itinerary',
              'Help with coding',
            ].map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => setInput(suggestion)}
                className="p-4 text-left bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl hover:bg-[var(--background-secondary)] transition-colors text-sm text-[var(--text-primary)]"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <div className="w-full relative">
            <div className="relative bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl shadow-sm focus-within:border-[var(--accent-blue)] focus-within:shadow-md transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message FacevoiceAI..."
                className="w-full px-4 py-3 pr-12 bg-transparent rounded-2xl text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none resize-none max-h-40 overflow-y-auto text-base"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-[var(--accent-blue)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2 text-center">
              FacevoiceAI can make mistakes. Check important info.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--background)] flex items-center justify-between">
        <button
          onClick={onModelSelectorToggle}
          className="px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
        >
          {getModelName()}
        </button>
        <div className="text-sm text-[var(--text-secondary)]">
          {chat.title}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
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
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                  }`}
                >
                  <p className="leading-relaxed whitespace-pre-wrap text-sm">
                    {message.content}
                  </p>
                </div>
                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-[var(--background-secondary)] border border-[var(--border-color)] flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-[var(--text-primary)]" />
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
              <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)] flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="bg-[var(--background-secondary)] rounded-2xl px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce" />
                  <div
                    className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  />
                  <div
                    className="w-2 h-2 bg-[var(--text-secondary)] rounded-full animate-bounce"
                    style={{ animationDelay: '0.4s' }}
                  />
                </div>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="px-4 py-4 border-t border-[var(--border-color)] bg-[var(--background)]">
        <div className="max-w-3xl mx-auto">
          <div className="relative bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl shadow-sm focus-within:border-[var(--accent-blue)] focus-within:shadow-md transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Message FacevoiceAI..."
              className="w-full px-4 py-3 pr-12 bg-transparent rounded-2xl text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none resize-none max-h-40 overflow-y-auto text-base"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-[var(--accent-blue)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-2 text-center">
            FacevoiceAI can make mistakes. Check important info.
          </p>
        </div>
      </div>
    </div>
  )
}
