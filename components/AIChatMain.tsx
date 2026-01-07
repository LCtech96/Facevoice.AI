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
  Image as ImageIcon,
  FileText,
  X,
  Copy,
  Check,
  FolderPlus,
  Users,
} from 'lucide-react'
import { Chat, Message } from '@/app/ai-chat/page'
import ClaudeChatInput from '@/components/ui/claude-style-chat-input'

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
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)
  const [isEditingImage, setIsEditingImage] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollToBottom()
  }, [chat?.messages])


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSendFromClaudeInput = async (data: {
    message: string;
    files: any[];
    pastedContent: { id: string; content: string; timestamp: Date }[];
    model: string;
    isThinkingEnabled: boolean;
  }) => {
    const messageContent = data.message.trim() || 
      (data.files.length > 0 ? `[${data.files.length} file(s) attached]` : '') ||
      (data.pastedContent.length > 0 ? `[${data.pastedContent.length} pasted content(s)]` : '')
    
    if (!messageContent || isLoading) return

    const userMessage: Message = {
      id: isSharedChat ? `temp-${Date.now()}` : Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    }

    // Aggiorna il modello se cambiato
    if (data.model && data.model !== selectedModel && onModelSelect) {
      onModelSelect(data.model)
    }
    
    // Usa il modello dalla data se fornito, altrimenti usa selectedModel
    const modelToUse = data.model || selectedModel

    handleSendMessage(userMessage, modelToUse)
  }

  const handleSendMessage = async (userMessage: Message, modelToUse: string) => {
    let updatedChat: Chat
    if (!chat) {
      updatedChat = {
        id: Date.now().toString(),
        title: userMessage.content.slice(0, 50),
        messages: [userMessage],
        createdAt: new Date(),
        updatedAt: new Date(),
        model: modelToUse,
      }
      onChatUpdate(updatedChat)
    } else {
      const updatedMessages = [...chat.messages, userMessage]
      updatedChat = {
        ...chat,
        messages: updatedMessages,
        title: chat.title === 'New Chat' ? userMessage.content.slice(0, 50) : chat.title,
        updatedAt: new Date(),
        model: modelToUse,
      }
      onChatUpdate(updatedChat)
    }
    
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
          model: modelToUse,
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

  // handleKeyPress removed - ClaudeChatInput handles keyboard events internally

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
        setUploadedImage(imageData)
        // Non chiudere il dialog, mostra opzioni di editing
      }
      reader.readAsDataURL(file)
    }
  }

  const handleGenerateImage = async () => {
    // Usa il prompt dall'ultimo messaggio della conversazione
    const prompt = chat?.messages[chat.messages.length - 1]?.content || 'a beautiful landscape'
    
    if (!prompt || prompt.length < 3) {
      alert('Scrivi un messaggio nella chat prima di generare un\'immagine, oppure usa almeno 3 caratteri come descrizione')
      return
    }

    setIsGeneratingImage(true)
    setShowImageDialog(false)

    try {
      const response = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          width: 1024,
          height: 1024,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate image')
      }

      const data = await response.json()
      
      // Aggiungi l'immagine generata come messaggio
      if (chat && data.imageUrl) {
        const imageMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `![Generated Image](${data.imageUrl})\n\n**Prompt:** ${prompt}`,
          timestamp: new Date(),
        }

        const updatedChat = {
          ...chat,
          messages: [...chat.messages, imageMessage],
          updatedAt: new Date(),
        }
        onChatUpdate(updatedChat)
      }
    } catch (error: any) {
      console.error('Error generating image:', error)
      alert(`Errore nella generazione: ${error.message}`)
      setShowImageDialog(true) // Riapri il dialog in caso di errore
    } finally {
      setIsGeneratingImage(false)
    }
  }

  const handleEditImage = async () => {
    if (!uploadedImage || !editPrompt.trim()) {
      alert('Carica un\'immagine e inserisci un prompt per generare una nuova immagine basata sulla descrizione')
      return
    }

    setIsEditingImage(true)

    try {
      const formData = new FormData()
      
      // Converti base64 in File
      const response = await fetch(uploadedImage)
      const blob = await response.blob()
      const file = new File([blob], 'image.png', { type: 'image/png' })
      
      formData.append('image', file)
      formData.append('prompt', editPrompt)

      const editResponse = await fetch('/api/image/edit', {
        method: 'POST',
        body: formData,
      })

      if (!editResponse.ok) {
        const error = await editResponse.json()
        throw new Error(error.error || 'Failed to edit image')
      }

      const data = await editResponse.json()
      
      // Aggiungi l'immagine modificata come messaggio
      if (chat && data.imageUrl) {
        const imageMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `![Edited Image](${data.imageUrl})\n\n**Prompt:** ${editPrompt}`,
          timestamp: new Date(),
        }

        const updatedChat = {
          ...chat,
          messages: [...chat.messages, imageMessage],
          updatedAt: new Date(),
        }
        onChatUpdate(updatedChat)
      }

      setUploadedImage(null)
      setEditPrompt('')
      setShowImageDialog(false)
    } catch (error: any) {
      console.error('Error editing image:', error)
      alert(`Errore nella modifica: ${error.message}`)
    } finally {
      setIsEditingImage(false)
    }
  }

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--background)]">
        {/* Header - Always visible */}
        <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--background)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Model selector removed */}
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
                onClick={() => {
                  // Per ora, quando si clicca una suggestion, la gestiamo manualmente
                  // Il componente ClaudeChatInput gestirà il proprio stato
                  handleSendFromClaudeInput({
                    message: suggestion,
                    files: [],
                    pastedContent: [],
                    model: selectedModel,
                    isThinkingEnabled: false,
                  })
                }}
                className="p-4 text-left bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl hover:bg-[var(--background-secondary)] transition-colors text-sm text-[var(--text-primary)]"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* Input Area - Claude Style */}
          <div className="w-full relative pb-4">
            <ClaudeChatInput
              onSendMessage={handleSendFromClaudeInput}
              selectedModel={selectedModel}
              models={[
                { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Fast and efficient' },
                { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Most intelligent model' },
                { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'High-quality with extended context' },
              ]}
              onModelSelect={(modelId) => onModelSelect(modelId)}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--background)] flex items-center justify-between">
        {/* Left side - Empty on mobile to leave space for hamburger, show delete button on desktop */}
        <div className="flex items-center gap-2">
          {/* Delete button - only on desktop */}
          {onDeleteChat && (
            <button
              onClick={onDeleteChat}
              className="hidden md:flex p-1.5 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Delete chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        {/* Center - Chat title (hidden on mobile) */}
        <div className="flex-1 text-center hidden md:block">
          <div className="text-sm text-[var(--text-secondary)]">
            {chat.title}
          </div>
        </div>
        
        {/* Right side - Settings and other buttons (ALWAYS on right, especially on mobile) */}
        <div className="flex items-center gap-2">
          {/* Delete button - only on mobile */}
          {onDeleteChat && (
            <button
              onClick={onDeleteChat}
              className="md:hidden p-1.5 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
              title="Delete chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chat.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
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
              {/* Render images if present in markdown format */}
              {msg.content.includes('![') && msg.content.match(/!\[.*?\]\((.*?)\)/g)?.map((imgMatch, idx) => {
                const urlMatch = imgMatch.match(/!\[.*?\]\((.*?)\)/)
                if (!urlMatch) return null
                const imageUrl = urlMatch[1]
                return (
                  <img 
                    key={idx}
                    src={imageUrl} 
                    alt="Generated" 
                    className="max-w-full rounded-lg my-2 max-h-96 object-contain"
                  />
                )
              })}
              {/* Render text content (remove image markdown for clean display) */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content.replace(/!\[.*?\]\(.*?\)/g, '').trim() || msg.content}
              </p>
              <p className="text-xs opacity-70 mt-1">
                {msg.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)]/20 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-[var(--accent-blue)]" />
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3 justify-start">
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

      {/* Input - Claude Style */}
      <div className="px-4 py-4 border-t border-[var(--border-color)] bg-[var(--background)]">
        <div className="max-w-3xl mx-auto">
          <ClaudeChatInput
            onSendMessage={handleSendFromClaudeInput}
            selectedModel={selectedModel}
            models={[
              { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Fast and efficient' },
              { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Most intelligent model' },
              { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: 'High-quality with extended context' },
            ]}
            onModelSelect={(modelId) => onModelSelect(modelId)}
            onOpenImageDialog={() => setShowImageDialog(true)}
          />
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
            onClick={() => {
              setShowImageDialog(false)
              setUploadedImage(null)
              setEditPrompt('')
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  {uploadedImage ? 'Modifica Immagine' : 'Genera o Carica Immagine'}
                </h3>
                <button
                  onClick={() => {
                    setShowImageDialog(false)
                    setUploadedImage(null)
                    setEditPrompt('')
                  }}
                  className="p-1 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>

              {uploadedImage ? (
                // Modalità editing
                <div className="space-y-4">
                  <img 
                    src={uploadedImage} 
                    alt="Uploaded" 
                    className="w-full rounded-lg max-h-64 object-contain bg-[var(--background-secondary)]"
                  />
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="Descrivi come vuoi modificare l'immagine o crea una nuova immagine basata su questa..."
                    className="w-full p-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] resize-none"
                    rows={3}
                  />
                  <div className="flex gap-2">
                <button
                      onClick={handleEditImage}
                      disabled={isEditingImage || !editPrompt.trim()}
                      className="flex-1 bg-[var(--accent-blue)] text-white px-4 py-2 rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 transition-colors"
                >
                      {isEditingImage ? 'Generazione in corso...' : 'Genera Nuova Immagine'}
                </button>
                    <button
                      onClick={() => {
                        setUploadedImage(null)
                        imageInputRef.current?.click()
                      }}
                      className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      Cambia
                    </button>
                  </div>
                </div>
              ) : (
                // Modalità generazione/caricamento
                <div className="space-y-3">
                <button
                  onClick={handleGenerateImage}
                    disabled={isGeneratingImage}
                    className="w-full px-4 py-3 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                    <span>{isGeneratingImage ? 'Generazione in corso...' : 'Genera Immagine da Prompt'}</span>
                </button>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-[var(--border-color)]"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-2 bg-[var(--card-background)] text-[var(--text-secondary)]">OPPURE</span>
                    </div>
              </div>
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full px-4 py-3 border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--background-secondary)] transition-colors flex items-center justify-center gap-2"
                  >
                    <ImageIcon className="w-5 h-5" />
                    <span>Carica Immagine per Modificare</span>
                  </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
                </div>
              )}
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
