"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowUpRight } from "lucide-react"

const testimonials = [
  {
    id: 1,
    quote: "A rare talent who bridges the gap between aesthetics and functionality with remarkable precision.",
    name: "Sarah Chen",
    role: "Design Director",
    company: "Figma",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=60",
  },
  {
    id: 2,
    quote: "Every pixel tells a story. Working together elevated our entire brand experience.",
    name: "Marcus Webb",
    role: "Creative Lead",
    company: "Stripe",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&auto=format&fit=crop&q=60",
  },
  {
    id: 3,
    quote: "Transforms complex problems into elegant, intuitive solutions that users love.",
    name: "Elena Voss",
    role: "Head of Product",
    company: "Linear",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=900&auto=format&fit=crop&q=60",
  },
]

export function TestimonialsSplit() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)

  const active = testimonials[activeIndex]

  const nextTestimonial = () => {
    setActiveIndex((prev) => (prev + 1) % testimonials.length)
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-12 bg-[var(--background)] rounded-2xl border border-[var(--border-color)]">
      <div
        className="relative grid grid-cols-[1fr_auto] gap-12 items-center cursor-pointer group"
        onClick={nextTestimonial}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div className="space-y-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.company}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="inline-flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-[var(--text-secondary)]"
            >
              <span className="w-8 h-px bg-[var(--text-secondary)]/50" />
              {active.company}
            </motion.div>
          </AnimatePresence>

          <div className="relative overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.blockquote
                key={active.id}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="text-3xl md:text-4xl font-light leading-[1.3] tracking-tight text-[var(--text-primary)]"
              >
                {active.quote}
              </motion.blockquote>
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={active.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="flex items-center gap-4"
            >
              <div className="w-10 h-px bg-[var(--text-primary)]/20" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{active.name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{active.role}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="relative w-48 h-64">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, filter: "blur(20px)", scale: 1.05 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              exit={{ opacity: 0, filter: "blur(20px)", scale: 0.95 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <div className="w-full h-full rounded-2xl overflow-hidden border border-[var(--border-color)]/50">
                <img
                  src={active.image || "/placeholder.svg"}
                  alt={active.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </motion.div>
          </AnimatePresence>

          <motion.div
            animate={{
              opacity: isHovering ? 1 : 0,
              scale: isHovering ? 1 : 0.8,
            }}
            transition={{ duration: 0.2 }}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-[var(--text-secondary)]"
          >
            <span>Next</span>
            <ArrowUpRight className="w-3 h-3" />
          </motion.div>
        </div>

        <div className="absolute -bottom-16 left-0 flex items-center gap-3">
          {testimonials.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation()
                setActiveIndex(index)
              }}
              className="relative p-1 group/dot"
            >
              <span
                className={`
                  block w-2 h-2 rounded-full transition-all duration-300
                  ${
                    index === activeIndex
                      ? "bg-[var(--text-primary)] scale-100"
                      : "bg-[var(--text-secondary)]/30 scale-75 hover:bg-[var(--text-secondary)]/50 hover:scale-100"
                  }
                `}
              />
              {index === activeIndex && (
                <motion.span
                  layoutId="activeDot"
                  className="absolute inset-0 border border-[var(--text-primary)]/30 rounded-full"
                  transition={{ duration: 0.3 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

