'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import Services from '@/components/Services'
import EarbudShowcase from '@/components/ui/spatial-product-showcase'
import { MarketingBadges } from '@/components/ui/marketing-badges'
import { MultiStepForm } from '@/components/ui/multistep-form'
import HeroButtonExpandable from '@/components/ui/hero-button-expendable'
import { VerticalImageStack } from '@/components/ui/vertical-image-stack'
import { AnimatedFolder } from '@/components/ui/3d-folder'
import { TestimonialsSplit } from '@/components/ui/split-testimonial'
import { LocationMap } from '@/components/ui/expand-map'
import { MiniChart } from '@/components/ui/mini-chart'
import { RatingInteraction } from '@/components/ui/emoji-rating'
import { TrelloKanbanBoard, type KanbanColumn } from '@/components/ui/trello-kanban-board'
import { ProjectShowcase } from '@/components/ui/project-showcase'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

export default function ServicesPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Caricamento...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation top */}
      <div className="md:hidden h-14" />
      
      {/* Services Section */}
      <Services />
      
      {/* Website Examples & Effects Section */}
      <section className="py-24 px-6 bg-[var(--background)]">
        <div className="container mx-auto max-w-7xl">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
            Website Examples & Effects
          </h2>
          <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
            Interactive components and effects to enhance your website experience
          </p>
          
          {/* Componenti disposti a coppie */}
          <div className="space-y-12">
            {/* Prima coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Spatial Product Showcase
                </h3>
                <EarbudShowcase />
              </div>
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Marketing Badges
                </h3>
                <MarketingBadges />
              </div>
            </div>
            
            {/* Seconda coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Multi-Step Form
                </h3>
                <MultiStepForm />
              </div>
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Hero Button Expandable
                </h3>
                <HeroButtonExpandable />
              </div>
            </div>
            
            {/* Terza coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Vertical Image Stack
                </h3>
                <VerticalImageStack />
              </div>
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  3D Folder
                </h3>
                <AnimatedFolder 
                  title="Branding"
                  projects={[
                    { id: "1", image: "https://images.unsplash.com/photo-1558655146-364adaf1fcc9?w=400&h=400&fit=crop", title: "Lumnia" },
                    { id: "2", image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=400&fit=crop", title: "Prism" },
                    { id: "3", image: "https://images.unsplash.com/photo-1557683316-973673baf926?w=400&h=400&fit=crop", title: "Vertex" },
                  ]}
                />
              </div>
            </div>
            
            {/* Quarta coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Split Testimonials
                </h3>
                <TestimonialsSplit />
              </div>
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Expand Map
                </h3>
                <LocationMap />
              </div>
            </div>
            
            {/* Quinta coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Mini Chart
                </h3>
                <MiniChart />
              </div>
              <div className="w-full flex flex-col items-center">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Emoji Rating
                </h3>
                <RatingInteraction />
              </div>
            </div>
            
            {/* Sesta coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Trello Kanban Board
                </h3>
                <TrelloKanbanBoard
                  columns={[
                    {
                      id: "todo",
                      title: "To Do",
                      tasks: [
                        { id: "1", title: "Create project documentation" },
                        { id: "2", title: "Design system components" },
                      ],
                    },
                    {
                      id: "in-progress",
                      title: "In Progress",
                      tasks: [
                        { id: "3", title: "Build authentication flow" },
                      ],
                    },
                    {
                      id: "done",
                      title: "Done",
                      tasks: [
                        { id: "4", title: "Project setup" },
                      ],
                    },
                  ]}
                  allowAddTask={false}
                />
              </div>
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Project Showcase
                </h3>
                <ProjectShowcase />
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

