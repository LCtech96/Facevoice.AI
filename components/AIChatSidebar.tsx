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
  LogOut,
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
  onLogout: () => void
}

const PROJECT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // yellow
  '#EF4444', // red
  '#8B5CF6', // purple
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
  onLogout,
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
        className="fixed left-4 top-24 z-40 p-2 glass-strong rounded-lg"
      >
        <Menu className="w-5 h-5 text-coral-red" />
      </button>
    )
  }

  return (
    <motion.div
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      className="w-64 glass-strong border-r border-coral-red/20 flex flex-col h-full rounded-r-3xl"
    >
      {/* Header */}
      <div className="p-4 border-b border-coral-red/20 flex items-center justify-between">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 px-4 py-3 glass rounded-2xl hover:glass-strong transition-all w-full border-2 border-transparent hover:border-coral-red/30"
        >
          <MessageSquare className="w-4 h-4 text-coral-red" />
          <span className="text-sm text-coral-red font-medium">New Chat</span>
        </button>
        <button
          onClick={onToggleSidebar}
          className="p-2 glass rounded-2xl hover:glass-strong transition-all ml-2 border-2 border-transparent hover:border-coral-red/30"
        >
          <X className="w-4 h-4 text-coral-red" />
        </button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-coral-red/20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-coral-red/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats"
            className="w-full pl-10 pr-4 py-3 glass-strong rounded-2xl text-sm text-coral-red placeholder-coral-red/60 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all"
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="p-4 border-b border-coral-red/20 space-y-2">
            <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-coral-red/70 hover:text-coral-red transition-colors rounded-2xl hover:glass">
              <Search className="w-4 h-4" />
              <span>Search Chat</span>
            </button>
            <button className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-coral-red/70 hover:text-coral-red transition-colors rounded-2xl hover:glass">
              <BookOpen className="w-4 h-4" />
              <span>Library</span>
            </button>
      </div>

      {/* GPT Section */}
      <div className="p-4 border-b border-coral-red/20">
        <h3 className="text-xs font-semibold text-coral-red/50 uppercase mb-2">GPT</h3>
        <button className="flex items-center gap-2 w-full px-2 py-2 text-sm text-coral-red/70 hover:text-coral-red transition-colors">
          <div className="w-4 h-4 grid grid-cols-2 gap-0.5">
            <div className="w-full h-full bg-coral-red rounded-sm"></div>
            <div className="w-full h-full bg-coral-red rounded-sm"></div>
            <div className="w-full h-full bg-coral-red rounded-sm"></div>
            <div className="w-full h-full bg-coral-red rounded-sm"></div>
          </div>
          <span>Explore</span>
        </button>
      </div>

      {/* Projects */}
      <div className="p-4 border-b border-coral-red/20 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-coral-red/50 uppercase">Projects</h3>
          <button
            onClick={() => setShowNewProject(!showNewProject)}
            className="p-1 hover:glass-strong rounded transition-all"
          >
            <FolderPlus className="w-4 h-4 text-coral-red" />
          </button>
        </div>

        <AnimatePresence>
          {showNewProject && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-2 p-2 glass rounded-lg"
            >
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full mb-2 px-2 py-1 glass rounded text-sm text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-transparent"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
                autoFocus
              />
              <div className="flex gap-1 mb-2">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-6 h-6 rounded-full border-2 ${
                      selectedColor === color ? 'border-coral-red' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  className="flex-1 px-2 py-1 glass-strong rounded text-sm text-coral-red hover:border-coral-red border-2 border-transparent transition-all"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewProject(false)
                    setNewProjectName('')
                  }}
                  className="px-2 py-1 glass rounded text-sm text-coral-red"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          {projects.map((project) => (
            <div key={project.id} className="group">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleProject(project.id)}
                  className="flex items-center gap-2 flex-1 px-2 py-1.5 text-sm text-coral-red/70 hover:text-coral-red transition-colors"
                >
                  {expandedProjects.has(project.id) ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="flex-1 text-left truncate">{project.name}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Sei sicuro di voler eliminare il progetto "${project.name}"?`)) {
                      onDeleteProject(project.id)
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:glass-strong rounded transition-all"
                  title="Elimina progetto"
                >
                  <Trash2 className="w-3 h-3 text-coral-red/50 hover:text-coral-red" />
                </button>
              </div>
              <AnimatePresence>
                {expandedProjects.has(project.id) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ml-6 space-y-1"
                  >
                    {project.chats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => onSelectChat(chat)}
                        className={`w-full px-2 py-1 text-xs text-left rounded truncate transition-colors ${
                          currentChat?.id === chat.id
                            ? 'text-coral-red-light glass-strong'
                            : 'text-coral-red/60 hover:text-coral-red hover:glass'
                        }`}
                      >
                        {chat.title}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Chat History */}
      <div className="p-4 border-t border-coral-red/20">
        <h3 className="text-xs font-semibold text-coral-red/50 uppercase mb-2">Your Chats</h3>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
                currentChat?.id === chat.id
                  ? 'glass-strong text-coral-red-light'
                  : 'hover:glass text-coral-red/70'
              }`}
            >
              <button
                onClick={() => onSelectChat(chat)}
                className="flex-1 text-left text-sm truncate"
              >
                {chat.title}
              </button>
              <button
                onClick={() => onDeleteChat(chat.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:glass-strong rounded transition-all"
              >
                <Trash2 className="w-3 h-3 text-coral-red/50 hover:text-coral-red" />
              </button>
            </div>
          ))}
          {chats.length === 0 && (
            <p className="text-xs text-coral-red/50 text-center py-4">
              No chats yet. Create one to get started!
            </p>
          )}
        </div>
      </div>

      {/* Logout Button */}
      <div className="p-4 border-t border-coral-red/20">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-coral-red/70 hover:text-coral-red transition-colors rounded-2xl hover:glass"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>
    </motion.div>
  )
}

