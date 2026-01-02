"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface Badge {
  id: string
  label: string
  color: string
  size: "sm" | "md" | "lg"
  rotation: number
  zIndex: number
  offsetX: number
  offsetY: number
}

const badges: Badge[] = [
  {
    id: "marketing",
    label: "marketing",
    color: "from-amber-300 to-yellow-400",
    size: "lg",
    rotation: -3,
    zIndex: 1,
    offsetX: -20,
    offsetY: -60,
  },
  {
    id: "seo",
    label: "SEO",
    color: "from-orange-400 to-orange-500",
    size: "sm",
    rotation: 2,
    zIndex: 2,
    offsetX: 60,
    offsetY: -35,
  },
  {
    id: "social-media",
    label: "social media",
    color: "from-amber-400 to-yellow-500",
    size: "lg",
    rotation: -2,
    zIndex: 3,
    offsetX: -30,
    offsetY: -15,
  },
  {
    id: "email-marketing",
    label: "email marketing",
    color: "from-pink-300 to-pink-400",
    size: "lg",
    rotation: 0,
    zIndex: 4,
    offsetX: 0,
    offsetY: 25,
  },
  {
    id: "conversions",
    label: "conversions",
    color: "from-blue-400 to-blue-500",
    size: "md",
    rotation: 3,
    zIndex: 5,
    offsetX: -15,
    offsetY: 65,
  },
  {
    id: "ads",
    label: "ads",
    color: "from-sky-300 to-sky-400",
    size: "sm",
    rotation: -1,
    zIndex: 6,
    offsetX: 50,
    offsetY: 90,
  },
]

const sizeClasses = {
  sm: "px-4 py-1.5 text-xs",
  md: "px-5 py-2 text-sm",
  lg: "px-6 py-2 text-sm",
}

const badgeExplanations: Record<string, { title: string; description: string }> = {
  marketing: {
    title: "Marketing Digitale",
    description: "Il marketing digitale è fondamentale per far crescere il tuo business online. Strategie mirate ti permettono di raggiungere il pubblico giusto, aumentare la visibilità e convertire i visitatori in clienti. Investire in marketing digitale significa costruire una presenza solida e sostenibile nel mercato digitale.",
  },
  "social-media": {
    title: "Social Media",
    description: "I social media sono il canale principale per connetterti con i tuoi clienti e costruire una community attiva. Una presenza strategica sui social aumenta la brand awareness, genera engagement e crea relazioni durature con il tuo pubblico. Essenziale per qualsiasi business moderno che vuole rimanere rilevante.",
  },
  "email-marketing": {
    title: "Email Marketing Automatizzato",
    description: "Noi di FacevoiceAI possiamo automatizzare completamente il tuo email marketing. Invii automatici personalizzati, campagne programmate, segmentazione avanzata e analisi dettagliate. L'automazione ti permette di mantenere i contatti con i clienti senza sforzo, aumentare le conversioni e ottimizzare il ROI delle tue campagne.",
  },
  ads: {
    title: "Pubblicità Digitale",
    description: "Le campagne pubblicitarie digitali sono essenziali per raggiungere nuovi clienti e scalare il tuo business. Targeting preciso, budget ottimizzato e monitoraggio in tempo reale garantiscono risultati misurabili. Investire in ads significa investire in crescita immediata e sostenibile.",
  },
  seo: {
    title: "SEO - Search Engine Optimization",
    description: "Una buona SEO è fondamentale per essere trovati su Google. Migliora la visibilità organica, aumenta il traffico qualificato e riduce i costi pubblicitari. Noi di FacevoiceAI sviluppiamo strategie SEO personalizzate per posizionare il tuo sito nelle prime posizioni dei risultati di ricerca, garantendo visibilità costante nel tempo.",
  },
  conversions: {
    title: "Ottimizzazione Conversioni",
    description: "Convertire i visitatori in clienti è l'obiettivo finale di qualsiasi strategia digitale. L'ottimizzazione delle conversioni analizza ogni aspetto del percorso utente per identificare e risolvere i punti critici. Migliorare il tasso di conversione significa massimizzare il valore di ogni visitatore che raggiunge il tuo sito.",
  },
}

export function MarketingBadgesHero() {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [clickedId, setClickedId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState<string | null>(null)

  const handleClick = (id: string) => {
    setShowModal(id)
  }

  const currentExplanation = showModal ? badgeExplanations[showModal] : null

  return (
    <>
      <div className="relative flex h-[250px] w-full items-center justify-center">
        {badges.map((badge) => {
          const isHovered = hoveredId === badge.id
          const isOtherHovered = hoveredId !== null && hoveredId !== badge.id

          return (
            <div
              key={badge.id}
              className={cn(
                "absolute cursor-pointer select-none rounded-full font-semibold transition-all duration-500 ease-out",
                "bg-gradient-to-b shadow-lg",
                badge.color,
                sizeClasses[badge.size],
                "hover:shadow-2xl",
              )}
              style={{
                transform: `
                  translate(${badge.offsetX * 0.7}px, ${badge.offsetY * 0.7}px) 
                  rotate(${isHovered ? 0 : badge.rotation}deg)
                  scale(${isHovered ? 1.08 : isOtherHovered ? 0.95 : 1})
                  translateY(${isHovered ? -8 : 0}px)
                `,
                zIndex: isHovered ? 100 : badge.zIndex,
                boxShadow: isHovered
                  ? "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 12px 24px -8px rgba(0, 0, 0, 0.15), inset 0 2px 4px rgba(255, 255, 255, 0.3)"
                  : "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 4px 10px -2px rgba(0, 0, 0, 0.1), inset 0 1px 2px rgba(255, 255, 255, 0.2)",
              }}
              onMouseEnter={() => setHoveredId(badge.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleClick(badge.id)}
            >
              <span
                className={cn(
                  "relative block transition-transform duration-300",
                  "text-slate-800 drop-shadow-[0_1px_1px_rgba(255,255,255,0.3)]",
                )}
                style={{
                  transform: isHovered ? "translateY(-1px)" : "translateY(0)",
                }}
              >
                {badge.label}
              </span>
              {/* Inner highlight effect */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full opacity-50"
                style={{
                  background: "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%)",
                }}
              />
            </div>
          )
        })}
      </div>

      {/* Modal/Disclaimer */}
      <AnimatePresence>
        {showModal && currentExplanation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                  {currentExplanation.title}
                </h3>
                <button
                  onClick={() => setShowModal(null)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                </button>
              </div>
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {currentExplanation.description}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}






