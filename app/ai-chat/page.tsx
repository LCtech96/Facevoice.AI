'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import AIChatSidebar from '@/components/AIChatSidebar'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { DEFAULT_CHAT_MODEL, resolveChatModel } from '@/lib/chat-models'
import type { User } from '@supabase/supabase-js'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  attachments?: Array<{ mimeType: string; data: string }>
}

export interface Chat {
  /** Le chat non ancora salvate sul server hanno un id 'draft-...'. */
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
  model?: string
  projectId?: string | null
}

export interface Project {
  id: string
  name: string
  color: string
  systemInstructions: string | null
  /** Derivato dalle chat: la sidebar lo usa per l'elenco annidato. */
  chats: Chat[]
}

export interface UsageState {
  spentUsd: number
  limitUsd: number
  remainingUsd: number
}

type ProjectRecord = {
  id: string
  name: string
  color: string | null
  system_instructions: string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Una chat esiste sul server solo se il suo id e' un UUID assegnato da
 * Postgres. Qualunque altro id (bozza locale, vecchio id da
 * localStorage) va trattato come non ancora salvata: mandarlo al server
 * darebbe "Chat non trovata".
 */
export function isPersistedChatId(id: string | null | undefined): boolean {
  return !!id && UUID_PATTERN.test(id)
}

export function isDraftChat(chat: Chat | null): boolean {
  return !!chat && !isPersistedChatId(chat.id)
}

export default function AIChatPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [projectRecords, setProjectRecords] = useState<ProjectRecord[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CHAT_MODEL)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null)
  const supabase = createClient()

  // Schermata fissa: niente scroll di pagina, niente rimbalzo elastico
  // su iOS. Scorrono solo la lista messaggi e la sidebar.
  useEffect(() => {
    const { style } = document.body
    const previousOverflow = style.overflow
    const previousOverscroll = style.overscrollBehavior
    const previousPadding = style.paddingBottom

    style.overflow = 'hidden'
    style.overscrollBehavior = 'none'
    // Il body ha un padding per la safe area: sommato a 100dvh
    // spingerebbe fuori schermo il campo di scrittura su iPhone.
    // Qui la safe area la gestisce gia' lo spaziatore in fondo.
    style.paddingBottom = '0px'

    return () => {
      style.overflow = previousOverflow
      style.overscrollBehavior = previousOverscroll
      style.paddingBottom = previousPadding
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const syncSidebar = () => setSidebarOpen(mq.matches)
    syncSidebar()
    mq.addEventListener('change', syncSidebar)
    return () => mq.removeEventListener('change', syncSidebar)
  }, [])

  // --- Autenticazione ------------------------------------------------
  useEffect(() => {
    const checkAuth = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user) {
        router.push('/auth')
        return
      }
      setUser(data.user)
    }

    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.push('/auth')
      } else {
        setUser(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [router, supabase])

  // --- Carico chat e progetti dal database ---------------------------
  const loadWorkspace = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) {
      router.push('/auth')
      return
    }

    try {
      const response = await fetch('/api/chat/chats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (!response.ok) {
        // 403 = registrato ma non abilitato alla chat interna.
        setAccessError(data.error || 'Accesso non consentito.')
        return
      }

      setAccessError(null)
      setChats(
        (data.chats || []).map((chat: any): Chat => ({
          id: chat.id,
          title: chat.title,
          model: resolveChatModel(chat.model),
          projectId: chat.project_id,
          createdAt: new Date(chat.created_at),
          updatedAt: new Date(chat.updated_at),
          messages: (chat.messages || []).map((msg: any): Message => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.created_at),
            attachments: msg.attachments || undefined,
          })),
        }))
      )
      setProjectRecords(data.projects || [])
      if (data.usage) setUsage(data.usage)
    } catch (error) {
      console.error('Workspace load error:', error)
      setAccessError('Impossibile caricare le conversazioni.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (user) loadWorkspace()
  }, [user, loadWorkspace])

  // --- Messaggio iniziale arrivato dalla home -------------------------
  useEffect(() => {
    if (loading || accessError || !user) return

    const initialMessage = localStorage.getItem('initial-message')
    if (!initialMessage) return
    localStorage.removeItem('initial-message')

    const draft = createDraftChat(selectedModel, null)
    setChats((prev) => [draft, ...prev])
    setCurrentChatId(draft.id)
    // AIChatMain manda il messaggio quando riceve il draft precompilato.
    setPendingInitialMessage(initialMessage)
  }, [loading, accessError, user, selectedModel])

  const currentChat = chats.find((chat) => chat.id === currentChatId) ?? null

  const authFetch = async (url: string, init: RequestInit = {}) => {
    const token = await getAccessToken()
    if (!token) throw new Error('Sessione scaduta.')
    return fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    })
  }

  // --- Chat ------------------------------------------------------------
  const createNewChat = () => {
    const draft = createDraftChat(selectedModel, currentChat?.projectId ?? null)
    setChats((prev) => [draft, ...prev])
    setCurrentChatId(draft.id)
    setIsModelSelectorOpen(false)
  }

  const selectChat = (chat: Chat) => {
    setCurrentChatId(chat.id)
    if (chat.model) setSelectedModel(resolveChatModel(chat.model))
    setIsModelSelectorOpen(false)
  }

  /**
   * Aggiorna lo stato locale. I messaggi li salva il server dentro
   * /api/chat, quindi qui non serve persistere: l'unica cosa da
   * gestire e' il passaggio da id 'draft-...' a id reale.
   */
  const updateChat = (updatedChat: Chat, previousId?: string) => {
    setChats((prev) => {
      const targetId = previousId ?? updatedChat.id
      const exists = prev.some((chat) => chat.id === targetId)
      if (!exists) return [updatedChat, ...prev]
      return prev.map((chat) => (chat.id === targetId ? updatedChat : chat))
    })
    setCurrentChatId(updatedChat.id)
  }

  const deleteChat = async (chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId))
    if (currentChatId === chatId) setCurrentChatId(null)

    if (!isPersistedChatId(chatId)) return

    try {
      await authFetch(`/api/chat/chats/${chatId}`, { method: 'DELETE' })
    } catch (error) {
      console.error('Delete chat error:', error)
      loadWorkspace()
    }
  }

  // --- Progetti --------------------------------------------------------
  const createProject = async (name: string, color: string) => {
    try {
      const response = await authFetch('/api/chat/projects', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      })
      const data = await response.json()
      if (response.ok && data.project) {
        setProjectRecords((prev) => [...prev, data.project])
      }
    } catch (error) {
      console.error('Create project error:', error)
    }
  }

  const updateProject = async (
    projectId: string,
    updates: { name?: string; color?: string; system_instructions?: string }
  ) => {
    try {
      const response = await authFetch(`/api/chat/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
      const data = await response.json()
      if (response.ok && data.project) {
        setProjectRecords((prev) =>
          prev.map((project) => (project.id === projectId ? data.project : project))
        )
      }
    } catch (error) {
      console.error('Update project error:', error)
    }
  }

  const deleteProject = async (projectId: string) => {
    setProjectRecords((prev) => prev.filter((project) => project.id !== projectId))
    // Le chat restano, escono solo dal progetto (ON DELETE SET NULL).
    setChats((prev) =>
      prev.map((chat) => (chat.projectId === projectId ? { ...chat, projectId: null } : chat))
    )

    try {
      await authFetch(`/api/chat/projects/${projectId}`, { method: 'DELETE' })
    } catch (error) {
      console.error('Delete project error:', error)
      loadWorkspace()
    }
  }

  const addChatToProject = async (chatId: string, projectId: string) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, projectId } : chat))
    )

    // Un draft non esiste ancora sul server: erediterà il progetto
    // quando viene creato col primo messaggio.
    if (!isPersistedChatId(chatId)) return

    try {
      await authFetch(`/api/chat/chats/${chatId}`, {
        method: 'PATCH',
        body: JSON.stringify({ project_id: projectId }),
      })
    } catch (error) {
      console.error('Move chat error:', error)
      loadWorkspace()
    }
  }

  // --- Derivati --------------------------------------------------------
  const projects: Project[] = projectRecords.map((record) => ({
    id: record.id,
    name: record.name,
    color: record.color || '#3b82f6',
    systemInstructions: record.system_instructions,
    chats: chats.filter((chat) => chat.projectId === record.id),
  }))

  const query = searchQuery.toLowerCase()
  const filteredChats = chats.filter(
    (chat) =>
      chat.title.toLowerCase().includes(query) ||
      chat.messages.some((msg) => msg.content.toLowerCase().includes(query))
  )

  // --- Render ----------------------------------------------------------
  if (loading) {
    return (
      <main className="h-[100dvh] bg-[var(--background)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-secondary)]">Caricamento...</p>
        </div>
      </main>
    )
  }

  if (!user) return null

  if (accessError) {
    return (
      <main className="h-[100dvh] bg-[var(--background)] flex flex-col overflow-hidden">
        <Navigation />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
              Accesso non abilitato
            </h1>
            <p className="text-[var(--text-secondary)]">{accessError}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="h-[100dvh] bg-[var(--background)] flex flex-col overflow-hidden">
      <Navigation />

      {/* Spazio per la navbar desktop, che e' in posizione fissa */}
      <div className="hidden md:block h-16 shrink-0" />

      {/* flex-1 + min-h-0: l'area chat prende lo spazio che resta senza
          bisogno di calcoli su vh, che su iPhone sbagliano quando la
          barra del browser si ritrae. */}
      <div className="flex flex-1 w-full min-h-0 overflow-hidden relative">
        <AIChatSidebar
          chats={filteredChats}
          projects={projects}
          currentChat={currentChat}
          sidebarOpen={sidebarOpen}
          searchQuery={searchQuery}
          usage={usage}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onNewChat={createNewChat}
          onSelectChat={selectChat}
          onDeleteChat={deleteChat}
          onCreateProject={createProject}
          onUpdateProject={updateProject}
          onDeleteProject={deleteProject}
          onAddChatToProject={addChatToProject}
          onSearchChange={setSearchQuery}
        />

        <AIChatMain
          chat={currentChat}
          selectedModel={selectedModel}
          isModelSelectorOpen={isModelSelectorOpen}
          initialMessage={pendingInitialMessage}
          onInitialMessageSent={() => setPendingInitialMessage(null)}
          onUsageUpdate={setUsage}
          onModelSelectorToggle={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onModelSelect={(model) => {
            setSelectedModel(model)
            if (currentChat) {
              updateChat({ ...currentChat, model })
              if (!isDraftChat(currentChat)) {
                authFetch(`/api/chat/chats/${currentChat.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ model }),
                }).catch((error) => console.error('Model update error:', error))
              }
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
                router.push(`/ai-chat/group/${data.groupChat.id}`)
              }
            } catch (error) {
              console.error('Error creating group chat:', error)
            }
          }}
          onDeleteChat={currentChat ? () => deleteChat(currentChat.id) : undefined}
          onShowProjects={() => {
            if (!sidebarOpen) setSidebarOpen(true)
          }}
          onCreateProject={() => setSidebarOpen(true)}
        />

        {isModelSelectorOpen && (
          <ModelSelector
            selectedModel={selectedModel}
            onSelect={(model) => {
              setSelectedModel(model)
              setIsModelSelectorOpen(false)
              if (currentChat) updateChat({ ...currentChat, model })
            }}
            onClose={() => setIsModelSelectorOpen(false)}
          />
        )}
      </div>

      {/* Spazio per la barra di navigazione mobile, anch'essa fissa.
          env(safe-area-inset-bottom) copre la home bar di iPhone. */}
      <div className="shrink-0 md:hidden h-[calc(4.25rem+env(safe-area-inset-bottom,0px))]" />
    </main>
  )
}

function createDraftChat(model: string, projectId: string | null): Chat {
  return {
    id: `draft-${Date.now()}`,
    title: 'Nuova chat',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    model,
    projectId,
  }
}
