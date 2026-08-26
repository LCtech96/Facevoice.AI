'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'
import { Chat } from '@/app/ai-chat/page'
import { Copy, Check, Users, ArrowLeft } from 'lucide-react'
import { DEFAULT_CHAT_MODEL } from '@/lib/chat-models'

export default function GroupChatPage() {
  const params = useParams()
  const router = useRouter()
  const groupId = params?.id as string
  const [chat, setChat] = useState<Chat | null>(null)
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CHAT_MODEL)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  useEffect(() => {
    if (groupId) {
      const link = `${window.location.origin}/ai-chat/group/${groupId}`
      setShareLink(link)

      const savedGroupChats = localStorage.getItem('group-chats')
      const groupChats = savedGroupChats ? JSON.parse(savedGroupChats) : {}

      if (!groupChats[groupId]) {
        groupChats[groupId] = {
          id: groupId,
          title: 'Group Chat',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: selectedModel,
        }
        localStorage.setItem('group-chats', JSON.stringify(groupChats))
      }

      const groupChat = groupChats[groupId]
      setChat({
        ...groupChat,
        messages: groupChat.messages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
        createdAt: new Date(groupChat.createdAt),
        updatedAt: new Date(groupChat.updatedAt),
      })
    }
  }, [groupId, selectedModel])

  const updateChat = (updatedChat: Chat) => {
    setChat(updatedChat)
    const savedGroupChats = localStorage.getItem('group-chats')
    const groupChats = savedGroupChats ? JSON.parse(savedGroupChats) : {}
    groupChats[groupId] = {
      ...updatedChat,
      messages: updatedChat.messages.map((msg) => ({
        ...msg,
        timestamp: msg.timestamp.toISOString(),
      })),
      createdAt: updatedChat.createdAt.toISOString(),
      updatedAt: updatedChat.updatedAt.toISOString(),
    }
    localStorage.setItem('group-chats', JSON.stringify(groupChats))
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--background)] flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:pb-0">
      <Navigation />

      <div className="hidden md:block h-16 shrink-0" />

      <div className="flex flex-1 w-full min-h-0 h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-4rem)] overflow-hidden relative">
        <aside className="hidden md:flex w-64 shrink-0 bg-[var(--background-secondary)] border-r border-[var(--border-color)] p-4 flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-[var(--accent-blue)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Group Chat</h2>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Chat condivisa in tempo reale con i tuoi colleghi.
          </p>
          <div className="mb-4 p-3 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg">
            <p className="text-xs text-[var(--text-secondary)] mb-2">Condividi questo link:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 min-w-0 px-2 py-1 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded text-xs text-[var(--text-primary)] truncate"
              />
              <button
                onClick={copyLink}
                className="p-1.5 bg-[var(--accent-blue)] text-white rounded hover:opacity-90 transition-opacity shrink-0"
                title="Copy link"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button
            onClick={() => router.push('/ai-chat')}
            className="mt-auto w-full px-3 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Torna alla chat
          </button>
        </aside>

        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          <div className="md:hidden px-2 py-2 border-b border-[var(--border-color)] flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push('/ai-chat')}
              className="p-2 rounded-lg hover:bg-[var(--background-secondary)] transition-colors"
              aria-label="Torna alla chat"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium truncate flex-1">Group Chat</span>
            <button
              onClick={() => setShowInfo(!showInfo)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-primary)]"
            >
              {showInfo ? 'Chiudi' : 'Info'}
            </button>
          </div>

          {showInfo && (
            <div className="md:hidden px-3 py-3 border-b border-[var(--border-color)] bg-[var(--background-secondary)] shrink-0">
              <p className="text-xs text-[var(--text-secondary)] mb-2">Condividi questo link:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 min-w-0 px-2 py-1.5 bg-[var(--card-background)] border border-[var(--border-color)] rounded text-xs truncate"
                />
                <button
                  onClick={copyLink}
                  className="p-2 bg-[var(--accent-blue)] text-white rounded-lg shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

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
        </div>

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
