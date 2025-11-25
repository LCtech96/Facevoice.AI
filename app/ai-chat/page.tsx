'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Navigation from '@/components/Navigation'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import AIChatSidebar from '@/components/AIChatSidebar'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'
import LiquidGlass from '@/components/LiquidGlass'
import AuthModal from '@/components/AuthModal'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [trinacriaImage, setTrinacriaImage] = useState('/team/Trinacria.jpg')
  const supabase = createClient()

  // Check authentication status
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
      
      if (!user) {
        setShowAuthModal(true)
      }
    }

    checkUser()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setShowAuthModal(false)
      } else {
        setShowAuthModal(true)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Load chats from localStorage on mount
  useEffect(() => {
    if (!user) return
    
    const savedChats = localStorage.getItem('ai-chats')
    const savedProjects = localStorage.getItem('ai-projects')
    const savedCurrentChat = localStorage.getItem('current-chat-id')

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
  }, [user])

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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    router.push('/')
  }

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.messages.some((msg) =>
      msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  )

  if (loading) {
    return (
      <main className="min-h-screen relative">
        {/* Immagine di sfondo Trinacria */}
        <div className="fixed inset-0 z-0">
          <Image
            src={trinacriaImage}
            alt="Trinacria background"
            fill
            className="object-cover opacity-20"
            priority
            quality={90}
            onError={() => {
              // Fallback se l'immagine non carica
              console.warn('Immagine Trinacria non trovata')
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--background-end)]" />
        </div>
        
        <LiquidGlass />
        <ThemeSwitcher />
        <Navigation 
          activeSection="chat" 
          setActiveSection={(section) => {
            if (section !== 'chat') {
              router.push('/')
            }
          }} 
        />
        <div className="flex items-center justify-center h-[calc(100vh-5rem)] mt-20 relative z-10">
          <div className="text-coral-red">Caricamento...</div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen relative">
      {/* Immagine di sfondo Trinacria */}
      <div className="fixed inset-0 z-0">
        <Image
          src={trinacriaImage}
          alt="Trinacria background"
          fill
          className="object-cover opacity-20"
          priority
          quality={90}
          onError={() => {
            // Fallback se l'immagine non carica
            console.warn('Immagine Trinacria non trovata')
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--background-end)]" />
      </div>
      
      <LiquidGlass />
      <ThemeSwitcher />
      <Navigation 
        activeSection="chat" 
        setActiveSection={(section) => {
          if (section !== 'chat') {
            router.push('/')
          }
        }} 
      />
      
          <AuthModal
            isOpen={showAuthModal}
            onClose={() => {
              if (!user) {
                router.push('/')
              }
            }}
            onSuccess={() => {
              setShowAuthModal(false)
            }}
            googleOnly={true}
          />

      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-20" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-4" />

      {!user ? (
        <div className="flex items-center justify-center h-[calc(100vh-5rem)] relative z-10">
          <div className="text-center">
            <p className="text-coral-red mb-4">Autenticazione richiesta</p>
            <p className="text-coral-red/70 text-sm">Effettua il login per utilizzare la Chat AI</p>
          </div>
        </div>
      ) : (
        <div className="flex h-[calc(100vh-5rem)] gap-2 px-2 relative z-10">
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
          onLogout={handleLogout}
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
      )}
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

