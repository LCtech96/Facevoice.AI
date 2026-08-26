'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Search,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  X,
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
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#FF3B30',
  '#AF52DE',
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

  const handleSelectChat = (chat: Chat) => {
    onSelectChat(chat)
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      onToggleSidebar()
    }
  }

  const handleNewChat = () => {
    onNewChat()
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      onToggleSidebar()
    }
  }

  if (!sidebarOpen) {
    return null
  }

  const sidebarContent = (
    <>
      <button
        onClick={onToggleSidebar}
        className="absolute top-3 right-3 z-50 p-1.5 text-[var(--text-secondary)] hover:bg-[var(--background-hover)] rounded-lg transition-colors"
        title="Close sidebar"
        aria-label="Close sidebar"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="p-3 border-b border-[var(--border-color)]">
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 px-3 py-2 w-full bg-[var(--accent-blue)] text-white rounded-lg hover:opacity-90 transition-all font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
      </div>

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

      {projects.length > 0 && (
        <div className="p-3 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Projects</h3>
            <button
              onClick={() => setShowNewProject(!showNewProject)}
              className="p-1 hover:bg-[var(--background-secondary)] rounded transition-colors"
            >
              <FolderPlus className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>
          </div>
          <AnimatePresence>
            {showNewProject && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 p-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg"
              >
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="w-full mb-2 px-2 py-1.5 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
                  autoFocus
                />
                <div className="flex gap-1 mb-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`w-6 h-6 rounded-full border-2 ${
                        selectedColor === color ? 'border-[var(--accent-blue)]' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateProject}
                    className="flex-1 px-2 py-1.5 bg-[var(--accent-blue)] text-white rounded text-sm hover:opacity-90 transition-opacity"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                    }}
                    className="px-2 py-1.5 bg-[var(--background-secondary)] rounded text-sm text-[var(--text-primary)] hover:bg-[var(--border-color)] transition-colors"
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
                    className="flex items-center gap-2 flex-1 px-2 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] rounded transition-colors min-w-0"
                  >
                    {expandedProjects.has(project.id) ? (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    )}
                    <div
                      className="w-3 h-3 rounded shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="flex-1 text-left truncate">{project.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Delete project "${project.name}"?`)) {
                        onDeleteProject(project.id)
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--background-secondary)] rounded transition-all shrink-0"
                  >
                    <Trash2 className="w-3 h-3 text-[var(--text-secondary)]" />
                  </button>
                </div>
                <AnimatePresence>
                  {expandedProjects.has(project.id) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="ml-6 space-y-1 mt-1"
                    >
                      {project.chats.map((chat) => (
                        <button
                          key={chat.id}
                          onClick={() => handleSelectChat(chat)}
                          className={`w-full px-2 py-1 text-xs text-left rounded truncate transition-colors ${
                            currentChat?.id === chat.id
                              ? 'text-[var(--accent-blue)] bg-[var(--accent-blue)]/10'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                          }`}
                        >
                          {chat.title}
                        </button>
                      ))}
                      {project.chats.length === 0 && (
                        <p className="text-xs text-[var(--text-secondary)] px-2 py-1">
                          No chats in this project
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div className="p-3 border-b border-[var(--border-color)]">
          <button
            onClick={() => setShowNewProject(!showNewProject)}
            className="w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] rounded-lg transition-colors flex items-center gap-2"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Project</span>
          </button>
          <AnimatePresence>
            {showNewProject && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 p-2 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg"
              >
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="w-full mb-2 px-2 py-1.5 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
                  autoFocus
                />
                <div className="flex gap-1 mb-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`w-6 h-6 rounded-full border-2 ${
                        selectedColor === color ? 'border-[var(--accent-blue)]' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateProject}
                    className="flex-1 px-2 py-1.5 bg-[var(--accent-blue)] text-white rounded text-sm hover:opacity-90 transition-opacity"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setShowNewProject(false)
                      setNewProjectName('')
                    }}
                    className="px-2 py-1.5 bg-[var(--background-secondary)] rounded text-sm text-[var(--text-primary)] hover:bg-[var(--border-color)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2 px-2">Chats</h3>
        <div className="space-y-1">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                currentChat?.id === chat.id
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'hover:bg-[var(--background-secondary)] text-[var(--text-primary)]'
              }`}
              onClick={() => handleSelectChat(chat)}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left text-sm truncate">{chat.title}</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {projects.length > 0 && (
                  <select
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (e.target.value) {
                        onAddChatToProject(chat.id, e.target.value)
                        e.target.value = ''
                      }
                    }}
                    className="text-xs bg-[var(--background-secondary)] border border-[var(--border-color)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none max-w-[5rem]"
                    defaultValue=""
                  >
                    <option value="">Add to project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteChat(chat.id)
                  }}
                  className="p-1 hover:bg-black/10 rounded transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {chats.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] text-center py-8">
              No chats yet. Create one to get started!
            </p>
          )}
        </div>
      </div>
    </>
  )

  return (
    <>
      <div
        className="md:hidden fixed inset-0 bg-black/50 z-40"
        onClick={onToggleSidebar}
        aria-hidden="true"
      />
      <motion.aside
        initial={{ x: -320 }}
        animate={{ x: 0 }}
        exit={{ x: -320 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed md:relative inset-y-0 left-0 z-50 md:z-auto w-[min(18rem,88vw)] md:w-64 bg-[var(--background-secondary)] border-r border-[var(--border-color)] flex flex-col h-full min-h-0 shadow-xl md:shadow-none"
      >
        {sidebarContent}
      </motion.aside>
    </>
  )
}
