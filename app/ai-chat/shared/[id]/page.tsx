'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'
import { Chat, Message } from '@/app/ai-chat/page'
import { createClient } from '@/lib/supabase-client'
import type { RealtimeChannel } from '@supabase/supabase-js'

export default function SharedChatPage() {
  const params = useParams()
  const router = useRouter()
  const chatId = params?.id as string
  const [chat, setChat] = useState<Chat | null>(null)
  const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()
  const channelRef = useRef<RealtimeChannel | null>(null)

  // Carica la chat e i messaggi iniziali
  useEffect(() => {
    if (!chatId) return

    const loadChat = async () => {
      try {
        console.log('Loading shared chat with ID:', chatId)
        const response = await fetch(`/api/chat/shared?id=${chatId}`)
        
        if (!response.ok) {
          console.error('Failed to fetch chat:', response.status, response.statusText)
          setIsLoading(false)
          return
        }
        
        const data = await response.json()
        console.log('API response:', data)

        if (data.success && data.chat) {
          console.log(`Chat loaded: ${data.chat.title}`)
          console.log(`Messages count: ${data.chat.messages?.length || 0}`)
          
          if (data.chat.messages && data.chat.messages.length > 0) {
            console.log('Sample message:', data.chat.messages[0])
          }
          
          const loadedChat: Chat = {
            id: data.chat.id,
            title: data.chat.title,
            messages: (data.chat.messages || []).map((msg: any) => ({
              id: msg.id,
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              timestamp: new Date(msg.created_at),
            })),
            createdAt: new Date(data.chat.created_at),
            updatedAt: new Date(data.chat.updated_at),
            model: data.chat.model || selectedModel,
          }
          
          console.log('Final loaded chat:', {
            id: loadedChat.id,
            title: loadedChat.title,
            messagesCount: loadedChat.messages.length,
            firstMessage: loadedChat.messages[0]?.content?.substring(0, 50),
          })
          
          setChat(loadedChat)
          setSelectedModel(loadedChat.model || selectedModel)
        } else {
          console.error('Failed to load chat - no success or chat data:', data)
        }
      } catch (error) {
        console.error('Error loading shared chat:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadChat()
  }, [chatId, selectedModel])

  // Sottoscrivi ai cambiamenti in tempo reale
  useEffect(() => {
    if (!chatId) return

    console.log('Setting up Realtime subscription for chat:', chatId)

    // Crea un canale per questa chat
    const channel = supabase
      .channel(`shared-chat-${chatId}`, {
        config: {
          broadcast: { self: true },
        },
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'shared_chat_messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          console.log('Realtime event received:', payload)
          const newMessage = payload.new as any
          const message: Message = {
            id: newMessage.id,
            role: newMessage.role as 'user' | 'assistant',
            content: newMessage.content,
            timestamp: new Date(newMessage.created_at),
          }

          console.log('New message from Realtime:', {
            id: message.id,
            role: message.role,
            content: message.content.substring(0, 50) + '...',
          })

          setChat((prev) => {
            if (!prev) {
              console.warn('Received Realtime message but chat is null')
              return prev
            }
            // Evita duplicati
            if (prev.messages.some((m) => m.id === message.id)) {
              console.log('Message already exists, skipping:', message.id)
              return prev
            }
            console.log('Adding new message to chat. Total messages:', prev.messages.length + 1)
            return {
              ...prev,
              messages: [...prev.messages, message],
              updatedAt: new Date(),
            }
          })
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('✓ Successfully subscribed to Realtime updates')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('✗ Realtime subscription error')
        }
      })

    channelRef.current = channel

    return () => {
      console.log('Unsubscribing from Realtime channel')
      channel.unsubscribe()
    }
  }, [chatId, supabase])

  const isProcessingRef = useRef(false)

  const updateChat = async (updatedChat: Chat) => {
    // Aggiorna sempre lo stato locale immediatamente per feedback visivo
    setChat(updatedChat)
    
    // Se c'è un nuovo messaggio utente con ID temporaneo, salvalo nel database
    const lastMessage = updatedChat.messages[updatedChat.messages.length - 1]
    if (lastMessage && lastMessage.role === 'user' && lastMessage.id.startsWith('temp-')) {
      // Evita di processare lo stesso messaggio due volte
      if (isProcessingRef.current) {
        console.log('Already processing a message, skipping duplicate')
        return
      }
      
      isProcessingRef.current = true
      console.log('Processing new user message:', lastMessage.content)
      
      try {
        // Salva il messaggio utente nel database
        const response = await fetch(`/api/chat/shared/${chatId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: lastMessage.content,
            userId: 'user',
            userName: 'User',
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Error saving user message:', errorData)
          isProcessingRef.current = false
          return
        }

        const data = await response.json()
        console.log('User message saved to database:', data.message.id)
        
        // Aggiorna l'ID del messaggio con quello del server
        setChat((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.id === lastMessage.id ? { ...msg, id: data.message.id } : msg
            ),
          }
        })

        // Prepara i messaggi per l'AI (solo user e assistant, escludi system)
        const messagesForAI = updatedChat.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content: m.content,
          }))

        // Invia il messaggio all'AI
        console.log('Sending to AI, messages count:', messagesForAI.length)
        try {
          const aiResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: messagesForAI,
              model: selectedModel,
            }),
          })

          if (!aiResponse.ok) {
            const errorData = await aiResponse.json().catch(() => ({}))
            console.error('Error getting AI response:', errorData)
            isProcessingRef.current = false
            return
          }

          const aiData = await aiResponse.json()
          console.log('AI response received:', aiData.message.substring(0, 50) + '...')
          
          // Salva la risposta dell'AI nel database
          // Questo triggerà Realtime e tutti vedranno il messaggio
          const aiMessageResponse = await fetch(`/api/chat/shared/${chatId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'assistant',
              content: aiData.message,
              userId: null,
              userName: 'AI',
            }),
          })

          if (aiMessageResponse.ok) {
            const aiMessageData = await aiMessageResponse.json()
            console.log('AI response saved to database:', aiMessageData.message.id)
          } else {
            const errorData = await aiMessageResponse.json().catch(() => ({}))
            console.error('Error saving AI response:', errorData)
          }
        } catch (error) {
          console.error('Error getting AI response:', error)
        }
      } catch (error) {
        console.error('Error saving message:', error)
      } finally {
        isProcessingRef.current = false
      }
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Caricamento chat...</div>
      </main>
    )
  }

  if (!chat) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Chat non trovata</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--background)] flex flex-col">
      <Navigation />
      
      {/* Spacing for desktop navigation */}
      <div className="hidden md:block h-16" />
      
      <div className="flex flex-1 w-full h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)] overflow-hidden relative">
        <AIChatMain
          chat={chat}
          selectedModel={selectedModel}
          isModelSelectorOpen={isModelSelectorOpen}
          onModelSelectorToggle={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
          onModelSelect={(model) => {
            setSelectedModel(model)
            if (chat) {
              updateChat({ ...chat, model })
            }
          }}
          onChatUpdate={updateChat}
          onCreateGroupChat={async () => {}}
          isSharedChat={true}
        />

        {isModelSelectorOpen && (
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={(model) => {
              setSelectedModel(model)
              setIsModelSelectorOpen(false)
              if (chat) {
                updateChat({ ...chat, model })
              }
            }}
            onClose={() => setIsModelSelectorOpen(false)}
          />
        )}
      </div>
    </main>
  )
}

