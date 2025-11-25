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
        const response = await fetch(`/api/chat/shared?id=${chatId}`)
        const data = await response.json()

        if (data.success && data.chat) {
          const loadedChat: Chat = {
            id: data.chat.id,
            title: data.chat.title,
            messages: data.chat.messages.map((msg: any) => ({
              id: msg.id,
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              timestamp: new Date(msg.created_at),
            })),
            createdAt: new Date(data.chat.created_at),
            updatedAt: new Date(data.chat.updated_at),
            model: data.chat.model || selectedModel,
          }
          setChat(loadedChat)
          setSelectedModel(loadedChat.model || selectedModel)
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

    // Crea un canale per questa chat
    const channel = supabase
      .channel(`shared-chat-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'shared_chat_messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newMessage = payload.new as any
          const message: Message = {
            id: newMessage.id,
            role: newMessage.role as 'user' | 'assistant',
            content: newMessage.content,
            timestamp: new Date(newMessage.created_at),
          }

          setChat((prev) => {
            if (!prev) return prev
            // Evita duplicati
            if (prev.messages.some((m) => m.id === message.id)) {
              return prev
            }
            return {
              ...prev,
              messages: [...prev.messages, message],
              updatedAt: new Date(),
            }
          })
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [chatId, supabase])

  const isProcessingRef = useRef(false)

  const updateChat = async (updatedChat: Chat) => {
    if (isProcessingRef.current) return
    
    setChat(updatedChat)
    
    // Se c'è un nuovo messaggio utente, invialo al server
    const lastMessage = updatedChat.messages[updatedChat.messages.length - 1]
    if (lastMessage && lastMessage.role === 'user' && (lastMessage.id.startsWith('temp-') || lastMessage.id.match(/^\d+$/))) {
      isProcessingRef.current = true
      // Salva il messaggio utente nel database
      try {
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

        if (response.ok) {
          const data = await response.json()
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

          // Invia il messaggio all'AI
          try {
            const aiResponse = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: updatedChat.messages
                  .filter((m) => m.role !== 'system')
                  .map((m) => ({
                    role: m.role,
                    content: m.content,
                  })),
                model: selectedModel,
              }),
            })

            if (aiResponse.ok) {
              const aiData = await aiResponse.json()
              
              // Salva la risposta dell'AI nel database
              await fetch(`/api/chat/shared/${chatId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  role: 'assistant',
                  content: aiData.message,
                  userId: null,
                  userName: 'AI',
                }),
              })
            }
          } catch (error) {
            console.error('Error getting AI response:', error)
          }
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

