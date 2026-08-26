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
  Menu,
} from 'lucide-react'
import { Chat, Message } from '@/app/ai-chat/page'
import ClaudeChatInput from '@/components/ui/claude-style-chat-input'
import { CHAT_MODELS, getChatModelName, getChatErrorMessage } from '@/lib/chat-models'
import { filesToAttachments } from '@/lib/chat-attachments'

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
  onToggleSidebar?: () => void
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
  onToggleSidebar,
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
  const [imageGenPrompt, setImageGenPrompt] = useState('')
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
    const attachments = await filesToAttachments(data.files)
    const pastedText = data.pastedContent.map((item) => item.content).join('\n\n')
    const messageContent =
      [data.message.trim(), pastedText].filter(Boolean).join('\n\n') ||
      (attachments.length > 0 ? 'Analizza questa immagine.' : '')

    if (!messageContent || isLoading) return

    const userMessage: Message = {
      id: isSharedChat ? `temp-${Date.now()}` : Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      attachments: attachments.length > 0 ? attachments : undefined,
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
            attachments: msg.attachments,
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
        content: getChatErrorMessage(error),
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

  const getModelName = () => getChatModelName(selectedModel)

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
    const prompt =
      imageGenPrompt.trim() ||
      chat?.messages[chat.messages.length - 1]?.content?.trim() ||
      ''

    if (prompt.length < 3) {
      alert('Inserisci una descrizione di almeno 3 caratteri per generare l\'immagine')
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

      if (data.imageUrl) {
        let activeChat = chat
        if (!activeChat) {
          activeChat = {
            id: Date.now().toString(),
            title: prompt.slice(0, 50),
            messages: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            model: selectedModel,
          }
        }

        const imageMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `![Generated Image](${data.imageUrl})\n\n**Prompt:** ${prompt}`,
          timestamp: new Date(),
        }

        onChatUpdate({
          ...activeChat,
          messages: [...activeChat.messages, imageMessage],
          updatedAt: new Date(),
        })
        setImageGenPrompt('')
      }
    } catch (error: any) {
      console.error('Error generating image:', error)
      alert(`Errore nella generazione: ${error.message}`)
      setShowImageDialog(true)
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

  const renderChatHeader = (options: {
    title?: string
    showShare?: boolean
    shareDisabled?: boolean
  }) => (
    <div className="px-2 py-2 md:px-4 md:py-3 border-b border-[var(--border-color)] bg-[var(--background)] flex items-center gap-2 shrink-0 safe-area-top">
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {!isSharedChat && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors shrink-0"
            aria-label="Apri menu chat"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        {options.title && (
          <p className="text-sm font-medium text-[var(--text-primary)] truncate md:hidden flex-1 text-center px-1">
            {options.title}
          </p>
        )}
        {onDeleteChat && (
          <button
            onClick={onDeleteChat}
            className="hidden md:flex p-1.5 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors shrink-0"
            title="Delete chat"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {options.title && (
          <p className="hidden md:block text-sm text-[var(--text-secondary)] truncate flex-1 text-center">
            {options.title}
          </p>
        )}
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {onDeleteChat && (
          <button
            onClick={onDeleteChat}
            className="md:hidden p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
            title="Delete chat"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {!isSharedChat && (onCreateProject || onShowProjects) && (
          <button
            onClick={onShowProjects || onCreateProject}
            className="p-2 text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
            title="Progetti"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        )}
        {options.showShare !== false && !options.shareDisabled && !isSharedChat && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleShareChat}
            disabled={options.shareDisabled || isMigrating || !chat}
            className="p-2 sm:px-3 sm:py-1.5 bg-[var(--accent-blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title={chat ? 'Condividi Chat' : 'Crea una chat per condividere'}
          >
            {isMigrating ? (
              <Sparkles className="w-4 h-4 animate-pulse" />
            ) : (
              <Users className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">
              {isMigrating ? 'Condividendo...' : 'Condividi'}
            </span>
          </motion.button>
        )}
      </div>
    </div>
  )

  const imageDialog = (
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
              <div className="space-y-3">
                <textarea
                  value={imageGenPrompt}
                  onChange={(e) => setImageGenPrompt(e.target.value)}
                  placeholder="Descrivi l'immagine da generare..."
                  className="w-full p-3 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] resize-none"
                  rows={3}
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage}
                  className="w-full px-4 py-3 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>{isGeneratingImage ? 'Generazione in corso...' : 'Genera Immagine'}</span>
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
  )

  if (!chat) {
    return (
      <>
      <div className="flex-1 flex flex-col bg-[var(--background)] min-h-0 min-w-0">
        {renderChatHeader({ title: 'Nuova chat', shareDisabled: true })}
        
        <div className="flex-1 flex flex-col items-center justify-start md:justify-center px-2 sm:px-3 md:px-4 max-w-3xl mx-auto w-full min-h-0 overflow-y-auto pb-2">
          <div className="mb-4 md:mb-8 pt-2 md:pt-0">
            <h1 className="text-2xl md:text-4xl font-semibold text-[var(--text-primary)] mb-1 md:mb-2 text-center">
              FacevoiceAI
            </h1>
            <p className="text-sm md:text-base text-[var(--text-secondary)] text-center">
              How can I help you today?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3 w-full mb-4 md:mb-8">
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
                className="p-3 md:p-4 text-left bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl hover:bg-[var(--background-secondary)] transition-colors text-xs md:text-sm text-[var(--text-primary)]"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className="w-full relative pb-2 md:pb-4 shrink-0 sticky bottom-0 bg-[var(--background)]">
            <ClaudeChatInput
              onSendMessage={handleSendFromClaudeInput}
              selectedModel={selectedModel}
              models={[...CHAT_MODELS]}
              onModelSelect={(modelId) => onModelSelect(modelId)}
              onOpenImageDialog={() => setShowImageDialog(true)}
              compact
            />
          </div>
        </div>
      </div>
      {imageDialog}
      </>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--background)] min-h-0 min-w-0">
      {renderChatHeader({ title: chat.title })}

      <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 space-y-3 md:space-y-4 min-h-0">
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
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-3 py-2 md:px-4 ${
              msg.role === 'user'
                ? 'bg-[var(--accent-blue)] text-white'
                : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
            }`}>
              {msg.attachments?.map((attachment, idx) => (
                <img
                  key={idx}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt="Allegato"
                  className="max-w-full rounded-lg my-2 max-h-64 object-contain"
                />
              ))}
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

      <div className="px-2 py-2 md:px-4 md:py-4 border-t border-[var(--border-color)] bg-[var(--background)] shrink-0">
        <div className="max-w-3xl mx-auto">
          <ClaudeChatInput
            onSendMessage={handleSendFromClaudeInput}
            selectedModel={selectedModel}
            models={[...CHAT_MODELS]}
            onModelSelect={(modelId) => onModelSelect(modelId)}
            onOpenImageDialog={() => setShowImageDialog(true)}
            compact
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

      {imageDialog}

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
