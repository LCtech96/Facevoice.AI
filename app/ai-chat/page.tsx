'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import AIChatSidebar from '@/components/AIChatSidebar'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
  model?: string
}

export interface Project {
  id: string
  name: string
  chats: Chat[]
  color: string
}

export default function AIChatPage() {
  const router = useRouter()
  const [chats, setChats] = useState<Chat[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [currentChat, setCurrentChat] = useState<Chat | null>(null)
  const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Load chats from localStorage on mount
  useEffect(() => {
    
    const savedChats = localStorage.getItem('ai-chats')
    const savedProjects = localStorage.getItem('ai-projects')
    const savedCurrentChat = localStorage.getItem('current-chat-id')
    const initialMessage = localStorage.getItem('initial-message')

    if (savedChats) {
      const parsed = JSON.parse(savedChats).map((chat: any) => ({
        ...chat,
        messages: chat.messages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      }))
      setChats(parsed)
      
      if (savedCurrentChat) {
        const chat = parsed.find((c: Chat) => c.id === savedCurrentChat)
        if (chat) setCurrentChat(chat)
      }
    }

    if (savedProjects) {
      setProjects(JSON.parse(savedProjects))
    }

    // Se c'è un messaggio iniziale, crea una nuova chat
    if (initialMessage) {
      const newChat: Chat = {
        id: Date.now().toString(),
        title: initialMessage.slice(0, 50),
        messages: [{
          id: Date.now().toString(),
          role: 'user',
          content: initialMessage,
          timestamp: new Date(),
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
        model: selectedModel,
      }
      setChats((prev) => [newChat, ...prev])
      setCurrentChat(newChat)
      // Rimuovi il messaggio iniziale dal localStorage
      localStorage.removeItem('initial-message')
      
      // Invia automaticamente il messaggio all'AI
      setTimeout(() => {
        handleInitialMessage(newChat, initialMessage)
      }, 500)
    }
  }, [])

  const handleInitialMessage = async (chat: Chat, message: string) => {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message }],
          model: selectedModel,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const data = await response.json()
      
      if (data.message) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }

        const updatedChat: Chat = {
          ...chat,
          messages: [...chat.messages, assistantMessage],
          updatedAt: new Date(),
        }

        updateChat(updatedChat)
      }
    } catch (error) {
      console.error('Error sending initial message:', error)
    }
  }

  // Save chats to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('ai-chats', JSON.stringify(chats))
  }, [chats])

  // Save projects to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('ai-projects', JSON.stringify(projects))
  }, [projects])

  // Save current chat ID
  useEffect(() => {
    if (currentChat) {
      localStorage.setItem('current-chat-id', currentChat.id)
    } else {
      localStorage.removeItem('current-chat-id')
    }
  }, [currentChat])

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      model: selectedModel,
    }
    setChats((prev) => [newChat, ...prev])
    setCurrentChat(newChat)
    setIsModelSelectorOpen(false)
  }

  const selectChat = (chat: Chat) => {
    setCurrentChat(chat)
    if (chat.model) setSelectedModel(chat.model)
    setIsModelSelectorOpen(false)
  }

  const updateChat = (updatedChat: Chat) => {
    setChats((prev) => {
      const existingChat = prev.find((chat) => chat.id === updatedChat.id)
      if (existingChat) {
        return prev.map((chat) => (chat.id === updatedChat.id ? updatedChat : chat))
      } else {
        // New chat - add it to the beginning
        return [updatedChat, ...prev]
      }
    })
    // Select the chat if it's not already selected
    if (!currentChat || currentChat.id !== updatedChat.id) {
      setCurrentChat(updatedChat)
    } else {
      setCurrentChat(updatedChat)
    }
  }

  const deleteChat = (chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId))
    if (currentChat?.id === chatId) {
      setCurrentChat(null)
    }
    // Rimuovi la chat da tutti i progetti
    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        chats: project.chats.filter((c) => c.id !== chatId),
      }))
    )
  }

  const createProject = (name: string, color: string) => {
    const newProject: Project = {
      id: Date.now().toString(),
      name,
      chats: [],
      color,
    }
    setProjects((prev) => [...prev, newProject])
    return newProject
  }

  const addChatToProject = (chatId: string, projectId: string) => {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return

    setProjects((prev) =>
      prev.map((project) => {
        if (project.id === projectId) {
          return {
            ...project,
            chats: [...project.chats.filter((c) => c.id !== chatId), chat],
          }
        }
        return project
      })
    )
  }

  const deleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((project) => project.id !== projectId))
  }


  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.messages.some((msg) =>
      msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  )

  return (
    <main className="min-h-screen bg-[var(--background)] flex flex-col">
      <Navigation />
      
      {/* Spacing for desktop navigation */}
      <div className="hidden md:block h-16" />
      
      <div className="flex flex-1 w-full h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)] overflow-hidden relative">
        <AIChatSidebar
          chats={filteredChats}
          projects={projects}
          currentChat={currentChat}
          sidebarOpen={sidebarOpen}
          searchQuery={searchQuery}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onNewChat={createNewChat}
          onSelectChat={selectChat}
          onDeleteChat={deleteChat}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onAddChatToProject={addChatToProject}
          onSearchChange={setSearchQuery}
        />

        <AIChatMain
          chat={currentChat}
          selectedModel={selectedModel}
          isModelSelectorOpen={isModelSelectorOpen}
          onModelSelectorToggle={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
          onModelSelect={(model) => {
            setSelectedModel(model)
            if (currentChat) {
              updateChat({ ...currentChat, model })
            }
          }}
          onChatUpdate={updateChat}
          onCreateGroupChat={async (name) => {
            try {
              const res = await fetch('/api/chat/group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
              })
              const data = await res.json()
              if (data.groupChat) {
                // Navigate to group chat
                router.push(`/ai-chat/group/${data.groupChat.id}`)
              }
            } catch (error) {
              console.error('Error creating group chat:', error)
            }
          }}
          onDeleteChat={currentChat ? () => deleteChat(currentChat.id) : undefined}
        />

        {isModelSelectorOpen && (
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={(model) => {
              setSelectedModel(model)
              setIsModelSelectorOpen(false)
              if (currentChat) {
                updateChat({ ...currentChat, model })
              }
            }}
            onClose={() => setIsModelSelectorOpen(false)}
          />
        )}
      </div>
      
      {/* Spacing for mobile navigation */}
      <div className="md:hidden h-20" />
    </main>
  )
}

