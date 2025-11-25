'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Search,
  BookOpen,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  X,
  Menu,
} from 'lucide-react'
import { Chat, Project } from '@/app/ai-chat/page'

interface AIChatSidebarProps {
  chats: Chat[]
  projects: Project[]
  currentChat: Chat | null
  sidebarOpen: boolean
  searchQuery: string
  onToggleSidebar: () => void
  onNewChat: () => void
  onSelectChat: (chat: Chat) => void
  onDeleteChat: (chatId: string) => void
  onCreateProject: (name: string, color: string) => void
  onDeleteProject: (projectId: string) => void
  onAddChatToProject: (chatId: string, projectId: string) => void
  onSearchChange: (query: string) => void
}

const PROJECT_COLORS = [
  '#007AFF', // iOS Blue
  '#34C759', // iOS Green
  '#FF9500', // iOS Orange
  '#FF3B30', // iOS Red
  '#AF52DE', // iOS Purple
]

export default function AIChatSidebar({
  chats,
  projects,
  currentChat,
  sidebarOpen,
  searchQuery,
  onToggleSidebar,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onCreateProject,
  onDeleteProject,
  onAddChatToProject,
  onSearchChange,
}: AIChatSidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0])

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      onCreateProject(newProjectName.trim(), selectedColor)
      setNewProjectName('')
      setShowNewProject(false)
    }
  }

  if (!sidebarOpen) {
    return (
      <button
        onClick={onToggleSidebar}
        className="fixed left-4 top-4 z-40 p-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-sm hover:shadow-md transition-all"
      >
        <Menu className="w-5 h-5 text-[var(--text-primary)]" />
      </button>
    )
  }

  return (
    <motion.div
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      className="w-64 bg-[var(--background-secondary)] border-r border-[var(--border-color)] flex flex-col h-full"
    >
      {/* Header */}
      <div className="p-3 border-b border-[var(--border-color)]">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 px-3 py-2 w-full bg-[var(--accent-blue)] text-white rounded-lg hover:opacity-90 transition-all font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-[var(--border-color)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats"
            className="w-full pl-10 pr-4 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] focus:border-transparent"
          />
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                currentChat?.id === chat.id
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'hover:bg-[var(--background-secondary)] text-[var(--text-primary)]'
              }`}
              onClick={() => onSelectChat(chat)}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left text-sm truncate">{chat.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteChat(chat.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 rounded transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {chats.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] text-center py-8">
              No chats yet. Create one to get started!
            </p>
          )}
        </div>
      </div>

      {/* Close button for mobile */}
      <div className="p-3 border-t border-[var(--border-color)] md:hidden">
        <button
          onClick={onToggleSidebar}
          className="w-full px-3 py-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
        >
          Close
        </button>
      </div>
    </motion.div>
  )
}
