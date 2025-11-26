'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { useState, useEffect } from 'react'

interface ModelSelectorProps {
  selectedModel: string
  onSelect: (model: string) => void
  onClose: () => void
}

// Note: Server-side API keys (GEMINI_API_KEY) are not accessible from client
// We'll show Gemini models as available and let the server handle errors gracefully
const getApiKeyStatus = () => {
  return {
    hasGroqKey: true, // Groq is available by default
    hasGeminiKey: true, // Assume available - server will return error if not configured
    hasOpenAIKey: false,
    hasAnthropicKey: true, // Assume available - server will return error if not configured
  }
}

// Available models (Groq models are available by default)
const getAvailableModels = () => {
  const apiKeys = getApiKeyStatus()
  
  const models = [
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B',
      provider: 'Groq',
      description: 'Fast and efficient model - Best for quick responses',
      available: apiKeys.hasGroqKey,
    },
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B',
      provider: 'Groq',
      description: 'Most intelligent model - Advanced reasoning and capabilities',
      available: apiKeys.hasGroqKey,
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'Mixtral 8x7B',
      provider: 'Groq',
      description: 'High-quality model with extended context window',
      available: apiKeys.hasGroqKey,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'Google',
      description: 'Latest fast model with multimodal capabilities (text, images, video)',
      available: apiKeys.hasGeminiKey,
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'Google',
      description: 'Most advanced Gemini model with extended reasoning',
      available: apiKeys.hasGeminiKey,
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      provider: 'Google',
      description: 'Advanced model with 1M token context window',
      available: apiKeys.hasGeminiKey,
    },
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      provider: 'Google',
      description: 'Fast and efficient with multimodal support',
      available: apiKeys.hasGeminiKey,
    },
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      provider: 'Anthropic',
      description: 'Most powerful model - Best for complex reasoning',
      available: apiKeys.hasAnthropicKey,
    },
    {
      id: 'claude-3-sonnet',
      name: 'Claude 3 Sonnet',
      provider: 'Anthropic',
      description: 'Balanced performance and speed - Great for most tasks',
      available: apiKeys.hasAnthropicKey,
    },
    {
      id: 'claude-3-haiku',
      name: 'Claude 3 Haiku',
      provider: 'Anthropic',
      description: 'Fast and efficient - Best for quick responses',
      available: apiKeys.hasAnthropicKey,
    },
  ]
  
  return models
}

// Coming soon models (require API keys)
const COMING_SOON_MODELS = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'OpenAI',
    description: 'OpenAI\'s most advanced model',
    requiresKey: 'OpenAI API Key',
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'OpenAI',
    description: 'Faster GPT-4 with extended context',
    requiresKey: 'OpenAI API Key',
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'OpenAI',
    description: 'Fast and cost-effective model',
    requiresKey: 'OpenAI API Key',
  },
]

export default function ModelSelector({
  selectedModel,
  onSelect,
  onClose,
}: ModelSelectorProps) {
  const [availableModels, setAvailableModels] = useState(getAvailableModels())
  
  useEffect(() => {
    // Check API key availability on mount
    setAvailableModels(getAvailableModels())
  }, [])
  
  const models = availableModels.filter(m => m.available)
  const comingSoon = availableModels.filter(m => !m.available)
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-[var(--card-background)] rounded-2xl border border-[var(--border-color)] max-w-md w-full max-h-[80vh] overflow-y-auto shadow-xl"
        >
          {/* Header */}
          <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between sticky top-0 bg-[var(--card-background)] z-10">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Select Model</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-secondary)]" />
            </button>
          </div>

          {/* Available Models */}
          <div className="p-4">
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-3">
              Available Models
            </h3>
            <div className="space-y-2 mb-6">
              {models.length > 0 ? models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    if (model.available) {
                      onSelect(model.id)
                      onClose()
                    }
                  }}
                  disabled={!model.available}
                  className={`w-full p-4 text-left rounded-xl border transition-all ${
                    !model.available
                      ? 'opacity-50 cursor-not-allowed'
                      : selectedModel === model.id
                      ? 'bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]'
                      : 'bg-[var(--card-background)] border-[var(--border-color)] hover:bg-[var(--background-secondary)]'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={`font-medium ${
                          selectedModel === model.id
                            ? 'text-[var(--accent-blue)]'
                            : 'text-[var(--text-primary)]'
                        }`}>
                          {model.name}
                        </h4>
                        {selectedModel === model.id && (
                          <Check className="w-4 h-4 text-[var(--accent-blue)]" />
                        )}
                        {!model.available && (
                          <span className="text-xs px-2 py-0.5 bg-[var(--background-secondary)] rounded-full text-[var(--text-secondary)]">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-1">
                        {model.provider}
                      </p>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {model.description}
                      </p>
                    </div>
                  </div>
                </button>
              )) : (
                <p className="text-sm text-[var(--text-secondary)] text-center py-4">
                  No models available. Please configure API keys.
                </p>
              )}
            </div>

            {/* Coming Soon Models */}
            {comingSoon.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-3">
                  Coming Soon
                </h3>
                <div className="space-y-2">
                  {comingSoon.map((model) => (
                <div
                  key={model.id}
                  className="w-full p-4 text-left rounded-xl border bg-[var(--card-background)] border-[var(--border-color)] opacity-60 cursor-not-allowed"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-[var(--text-secondary)]">
                          {model.name}
                        </h4>
                        <span className="text-xs px-2 py-0.5 bg-[var(--background-secondary)] rounded-full text-[var(--text-secondary)]">
                          Coming Soon
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-1">
                        {model.provider}
                      </p>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {model.description}
                      </p>
                    </div>
                  </div>
                </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
