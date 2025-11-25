'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Check, X } from 'lucide-react'

interface ModelSelectorProps {
  selectedModel: string
  onSelect: (model: string) => void
  onClose: () => void
}

const AVAILABLE_MODELS = [
  {
    id: 'llama-3.1-8b-instant',
    name: 'Groq (Llama 3.1 8B)',
    description: 'Fast and efficient model - Best for quick responses',
    available: true,
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Groq (Llama 3.3 70B)',
    description: 'Most intelligent model - Advanced reasoning and capabilities',
    available: true,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Groq (Mixtral 8x7B)',
    description: 'High-quality model with extended context window',
    available: true,
  },
]

const COMING_SOON_MODELS = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    description: 'OpenAI\'s most advanced model',
    available: false,
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    description: 'Faster GPT-4 with extended context',
    available: false,
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    description: 'Fast and cost-effective model',
    available: false,
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    description: 'Anthropic\'s most powerful model',
    available: false,
  },
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    description: 'Balanced performance and speed',
    available: false,
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    description: 'Fast and efficient model',
    available: false,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    description: 'Google\'s advanced AI model',
    available: false,
  },
  {
    id: 'llama-3',
    name: 'Llama 3',
    description: 'Meta\'s open-source model',
    available: false,
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    description: 'Mistral AI\'s flagship model',
    available: false,
  },
]

export default function ModelSelector({
  selectedModel,
  onSelect,
  onClose,
}: ModelSelectorProps) {
  return (
    <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 glass-strong backdrop-blur-sm z-40 flex items-start justify-center pt-12 sm:pt-20 px-2"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: -20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong rounded-2xl border border-coral-red/40 max-w-2xl w-full mx-2 sm:mx-4 max-h-[85vh] sm:max-h-[80vh] overflow-y-auto backdrop-blur-xl shadow-2xl"
          >
          {/* Header */}
          <div className="p-6 border-b border-coral-red/30 flex items-center justify-between sticky top-0 glass-strong backdrop-blur-xl z-10">
            <h2 className="text-xl sm:text-2xl font-bold text-coral-red-light">Seleziona Modello AI</h2>
            <button
              onClick={onClose}
              className="p-2 glass rounded-lg hover:glass-strong transition-all touch-manipulation"
            >
              <X className="w-5 h-5 text-coral-red" />
            </button>
          </div>

          {/* Available Models */}
          <div className="p-4 sm:p-6">
            <h3 className="text-xs sm:text-sm font-semibold text-coral-red/50 uppercase mb-3 sm:mb-4">
              Modelli Disponibili
            </h3>
            <div className="space-y-2 mb-4 sm:mb-6">
              {AVAILABLE_MODELS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model.id)
                    onClose()
                  }}
                  className={`w-full p-3 sm:p-4 glass rounded-lg border-2 transition-all text-left touch-manipulation ${
                    selectedModel === model.id
                      ? 'border-coral-red glass-strong'
                      : 'border-transparent hover:glass-strong'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-coral-red-light">
                          {model.name}
                        </h4>
                        {selectedModel === model.id && (
                          <Check className="w-4 h-4 text-coral-red" />
                        )}
                      </div>
                      <p className="text-sm text-coral-red/70">
                        {model.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Coming Soon Models */}
            <h3 className="text-xs sm:text-sm font-semibold text-coral-red/50 uppercase mb-3 sm:mb-4">
              In Arrivo
            </h3>
            <div className="space-y-2">
              {COMING_SOON_MODELS.map((model) => (
                <div
                  key={model.id}
                  className="w-full p-3 sm:p-4 glass rounded-lg border-2 border-transparent opacity-60 cursor-not-allowed"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-coral-red/70">
                          {model.name}
                        </h4>
                        <span className="text-xs px-2 py-0.5 glass rounded-full text-coral-red/50">
                          Coming Soon
                        </span>
                      </div>
                      <p className="text-sm text-coral-red/50">
                        {model.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

