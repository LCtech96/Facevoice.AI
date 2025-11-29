'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Plus,
  User,
  Bot,
  Sparkles,
  Share2,
  Settings,
  Image as ImageIcon,
  FileText,
  X,
  Copy,
  Check,
  FolderPlus,
  Users,
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
  onDeleteChat?: () => void
  isSharedChat?: boolean // Indica se è una chat condivisa
  onCreateProject?: () => void // Callback per creare progetti
  onShowProjects?: () => void // Callback per mostrare progetti
  sidebarOpen?: boolean // Stato del sidebar per gestire il layout mobile
}

export default function AIChatMain({
  chat,
  selectedModel,
  isModelSelectorOpen,
  onModelSelectorToggle,
  onModelSelect,
  onChatUpdate,
  onCreateGroupChat,
  onDeleteChat,
  isSharedChat = false,
  onCreateProject,
  onShowProjects,
  sidebarOpen = false,
}: AIChatMainProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [showImageDialog, setShowImageDialog] = useState(false)
  const [showDocumentDialog, setShowDocumentDialog] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

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

    // Per le chat condivise, usa sempre un ID temporaneo
    // La pagina shared gestirà il salvataggio nel database
    const userMessage: Message = {
      id: isSharedChat ? `temp-${Date.now()}` : Date.now().toString(),
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
    
    // Per le chat condivise, non gestire l'AI qui - la pagina shared lo farà
    if (isSharedChat) {
      return
    }

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

  const [isMigrating, setIsMigrating] = useState(false)

  const handleShareChat = async () => {
    if (!chat) return
    
    setIsMigrating(true)
    try {
      // Crea una chat condivisa nel database
      const res = await fetch('/api/chat/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: chat.title || 'Shared Chat',
          model: chat.model || selectedModel,
        }),
      })
      const data = await res.json()
      
      if (!data.success || !data.chat) {
        console.error('Failed to create shared chat:', data)
        alert('Errore nella creazione della chat condivisa. Riprova.')
        setIsMigrating(false)
        return
      }

      console.log('Created shared chat:', data.chat.id)
      
      // Migra i messaggi esistenti alla chat condivisa
      if (chat.messages.length > 0) {
        console.log(`Migrating ${chat.messages.length} messages to shared chat ${data.chat.id}...`)
        
        // Migra sequenzialmente per evitare problemi
        for (let i = 0; i < chat.messages.length; i++) {
          const message = chat.messages[i]
          try {
            const response = await fetch(`/api/chat/shared/${data.chat.id}/message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: message.role,
                content: message.content,
                userId: 'migrated',
                userName: message.role === 'user' ? 'User' : 'AI',
              }),
            })
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              console.error(`Error migrating message ${i + 1}/${chat.messages.length}:`, errorData)
            } else {
              const result = await response.json()
              console.log(`✓ Migrated message ${i + 1}/${chat.messages.length} (ID: ${result.message?.id})`)
            }
            
            // Piccolo delay per evitare rate limiting
            await new Promise(resolve => setTimeout(resolve, 50))
          } catch (error) {
            console.error(`Error migrating message ${i + 1}:`, error)
          }
        }
        
        console.log('✓ Migration completed')
        
        // Verifica che i messaggi siano stati salvati
        const verifyRes = await fetch(`/api/chat/shared?id=${data.chat.id}`)
        const verifyData = await verifyRes.json()
        console.log(`Verified: ${verifyData.chat?.messages?.length || 0} messages in database`)
      }
      
      // Usa sempre window.location.origin per ottenere l'URL corretto (locale o produzione)
      const link = `${window.location.origin}/ai-chat/shared/${data.chat.id}`
      console.log('Share link:', link)
      setShareLink(link)
      setShowShareDialog(true)
      setIsMigrating(false)
    } catch (error) {
      console.error('Error creating share link:', error)
      alert('Errore nella creazione della chat condivisa. Controlla la console per i dettagli.')
      setIsMigrating(false)
    }
  }

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Handle document upload
      const reader = new FileReader()
      reader.onloadend = () => {
        const fileContent = reader.result as string
        // Add file content to input
        setInput(prev => prev + `\n[Document: ${file.name}]\n${fileContent}`)
      }
      reader.readAsText(file)
      setShowDocumentDialog(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const imageData = reader.result as string
        // Add image reference to input
        setInput(prev => prev + `\n[Image: ${file.name}]\n`)
        // Store image in chat or handle separately
      }
      reader.readAsDataURL(file)
      setShowImageDialog(false)
    }
  }

  const handleGenerateImage = () => {
    // This would trigger image generation via API
    setInput(prev => prev + '\n[Generate image based on conversation]')
    setShowImageDialog(false)
  }

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--background)]">
        {/* Header - Always visible */}
        <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--background)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onModelSelectorToggle}
              className="px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">{getModelName()}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Bottone Progetti/Impostazioni - Piccolo in alto a destra */}
            {!isSharedChat && (onCreateProject || onShowProjects) && (
              <button
                onClick={onShowProjects || onCreateProject}
                className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                title="Progetti e Impostazioni"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            )}
            
            {/* Bottone Chat Condivisa - In alto a destra (disabilitato quando non c'è chat) */}
            {!isSharedChat && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleShareChat}
                disabled={true}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-blue)]/50 text-white rounded-lg text-sm cursor-not-allowed opacity-50"
                title="Crea una chat per condividere"
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Condividi</span>
              </motion.button>
            )}
          </div>
        </div>
        
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
        {/* Left side - empty on mobile when sidebar closed to leave space for hamburger */}
        <div className={`flex items-center gap-2 ${!sidebarOpen ? 'md:flex hidden' : 'flex'}`}>
          <button
            onClick={onModelSelectorToggle}
            className="px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">{getModelName()}</span>
          </button>
          {onDeleteChat && (
            <button
              onClick={onDeleteChat}
              className="p-1.5 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Delete chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Right side - Settings button on mobile when sidebar closed */}
        {!sidebarOpen && (
          <div className="md:hidden flex items-center">
            <button
              onClick={onModelSelectorToggle}
              className="px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="text-sm text-[var(--text-secondary)] hidden sm:block">
            {chat.title}
          </div>
          
          {/* Bottone Progetti/Impostazioni - Piccolo in alto a destra */}
          {!isSharedChat && (onCreateProject || onShowProjects) && (
            <button
              onClick={onShowProjects || onCreateProject}
              className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Progetti e Impostazioni"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          )}
          
          {/* Bottone Chat Condivisa - In alto a destra */}
          {!isSharedChat && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleShareChat}
              disabled={isMigrating || !chat}
              className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              title={chat ? "Condividi Chat" : "Crea una chat per condividere"}
            >
              {isMigrating ? (
                <>
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  <span className="hidden sm:inline">Condividendo...</span>
                </>
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">Condividi</span>
                </>
              )}
            </motion.button>
          )}
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
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setShowDocumentDialog(true)}
              className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Upload document"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowImageDialog(true)}
              className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Upload or generate image"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          </div>
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

      {/* Share Dialog */}
      <AnimatePresence>
        {showShareDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowShareDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-6 max-w-md w-full shadow-xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Share Chat</h3>
                <button
                  onClick={() => setShowShareDialog(false)}
                  className="p-1 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Share this link with your colleagues to collaborate in real-time:
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)]"
                />
                <button
                  onClick={copyShareLink}
                  className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Dialog */}
      <AnimatePresence>
        {showImageDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowImageDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-6 max-w-md w-full shadow-xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Image Options</h3>
                <button
                  onClick={() => setShowImageDialog(false)}
                  className="p-1 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full px-4 py-3 bg-[var(--background-secondary)] hover:bg-[var(--accent-blue)]/10 rounded-lg text-[var(--text-primary)] transition-colors flex items-center gap-2"
                >
                  <ImageIcon className="w-5 h-5" />
                  <span>Upload Image</span>
                </button>
                <button
                  onClick={handleGenerateImage}
                  className="w-full px-4 py-3 bg-[var(--background-secondary)] hover:bg-[var(--accent-blue)]/10 rounded-lg text-[var(--text-primary)] transition-colors flex items-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>Generate Image</span>
                </button>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document Dialog */}
      <AnimatePresence>
        {showDocumentDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowDocumentDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-6 max-w-md w-full shadow-xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Upload Document</h3>
                <button
                  onClick={() => setShowDocumentDialog(false)}
                  className="p-1 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-3 bg-[var(--background-secondary)] hover:bg-[var(--accent-blue)]/10 rounded-lg text-[var(--text-primary)] transition-colors flex items-center gap-2"
                >
                  <FileText className="w-5 h-5" />
                  <span>Upload from Device</span>
                </button>
                <button
                  onClick={() => {
                    // Google Drive integration would go here
                    alert('Google Drive integration coming soon')
                  }}
                  className="w-full px-4 py-3 bg-[var(--background-secondary)] hover:bg-[var(--accent-blue)]/10 rounded-lg text-[var(--text-primary)] transition-colors flex items-center gap-2"
                >
                  <FileText className="w-5 h-5" />
                  <span>Import from Google Drive</span>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.doc,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
