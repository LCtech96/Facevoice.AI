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
    name: 'Llama 3.1 8B',
    description: 'Fast and efficient model - Best for quick responses',
    available: true,
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    description: 'Most intelligent model - Advanced reasoning and capabilities',
    available: true,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    description: 'High-quality model with extended context window',
    available: true,
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
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-[var(--card-background)] rounded-2xl border border-[var(--border-color)] max-w-md w-full shadow-xl"
        >
          {/* Header */}
          <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
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
            <div className="space-y-2">
              {AVAILABLE_MODELS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model.id)
                    onClose()
                  }}
                  className={`w-full p-4 text-left rounded-xl border transition-all ${
                    selectedModel === model.id
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
                      </div>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {model.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
