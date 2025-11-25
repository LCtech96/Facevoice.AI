'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import AIChatMain from '@/components/AIChatMain'
import ModelSelector from '@/components/ModelSelector'
import LiquidGlass from '@/components/LiquidGlass'
import { Chat, Message } from '@/app/ai-chat/page'
import { Link as LinkIcon, Copy, Check, Users } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function GroupChatPage() {
  const params = useParams()
  const router = useRouter()
  const groupId = params?.id as string
  const [chat, setChat] = useState<Chat | null>(null)
  const [selectedModel, setSelectedModel] = useState('llama-3.1-70b-versatile')
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (groupId) {
      const link = `${window.location.origin}/ai-chat/group/${groupId}`
      setShareLink(link)
      
      // Load or create group chat
      const savedGroupChats = localStorage.getItem('group-chats')
      let groupChats = savedGroupChats ? JSON.parse(savedGroupChats) : {}
      
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
  }, [groupId])

  const updateChat = (updatedChat: Chat) => {
    setChat(updatedChat)
    const savedGroupChats = localStorage.getItem('group-chats')
    let groupChats = savedGroupChats ? JSON.parse(savedGroupChats) : {}
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
    <main className="min-h-screen relative">
      <LiquidGlass />
      <ThemeSwitcher />
      <Navigation activeSection="chat" />

      <div className="flex h-[calc(100vh-5rem)] mt-20">
        {/* Group Chat Info Sidebar */}
        <div className="w-64 glass-strong border-r border-coral-red/20 p-4">
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-coral-red" />
              <h2 className="text-lg font-bold text-coral-red-light">Group Chat</h2>
            </div>
            <p className="text-sm text-coral-red/70">
              Your personal ChatGPT memory is never used in group chats.
            </p>
          </div>

          <div className="mb-4 p-3 glass rounded-lg">
            <p className="text-xs text-coral-red/50 mb-2">Share this link to invite others:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 px-2 py-1 glass rounded text-xs text-coral-red/70 truncate"
              />
              <button
                onClick={copyLink}
                className="p-1.5 glass-strong rounded hover:glass transition-all"
                title="Copy link"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-coral-red" />
                ) : (
                  <Copy className="w-4 h-4 text-coral-red" />
                )}
              </button>
            </div>
          </div>

          <div className="p-3 glass rounded-lg">
            <p className="text-xs text-coral-red/50 mb-1">ChatGPT can make mistakes.</p>
            <p className="text-xs text-coral-red/50">
              Make sure to verify important information.
            </p>
          </div>

          <button
            onClick={() => router.push('/ai-chat')}
            className="mt-4 w-full px-3 py-2 glass rounded-lg text-sm text-coral-red hover:glass-strong transition-all"
          >
            Back to Chat
          </button>
        </div>

        {/* Main Chat Area */}
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

