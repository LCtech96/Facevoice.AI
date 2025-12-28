'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Linkedin, Mail, Instagram, Twitter, Briefcase } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase-client'

interface TeamMember {
  id: number
  name: string
  role: string
  image_url: string | null
  description: string | null
  email: string | null
  linkedin: string | null
  instagram: string | null
  x: string | null
  google: string | null
  is_contractor: boolean | null
}

// Fallback data quando Supabase non è disponibile
const FALLBACK_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 1,
    name: 'Luca Corrao',
    role: 'CEO & Founder',
    description: 'Visionary leader with expertise in AI and blockchain technologies',
    email: 'luca@facevoice.ai',
    linkedin: 'https://linkedin.com/in/luca-corrao',
    image_url: '/team/Luca professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 2,
    name: 'Sevara Urmanaeva',
    role: 'CMO',
    description: 'Strategic marketing expert driving brand growth and digital innovation',
    email: 'sevara@facevoice.ai',
    linkedin: 'https://linkedin.com/in/sevara-urmanaeva',
    image_url: '/team/Sevara professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 3,
    name: 'Giuseppe Delli Paoli',
    role: 'Co-founder, AI & Automation Specialist',
    description: 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology',
    email: 'giuseppe@facevoice.ai',
    linkedin: 'https://linkedin.com/in/giuseppe-delli-paoli',
    image_url: '/team/Giuseppe professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 4,
    name: 'Sara Siddique',
    role: 'Data Engineer, Data Scientist',
    description: 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights',
    email: 'sara@facevoice.ai',
    linkedin: 'https://linkedin.com/in/sara-siddique',
    image_url: '/team/Sara professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 5,
    name: 'Jonh Mcnova',
    role: 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)',
    description: 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems',
    email: 'jonh@facevoice.ai',
    linkedin: 'https://linkedin.com/in/jonh-mcnova',
    image_url: '/team/Jonh professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 6,
    name: 'Leonardo Alotta',
    role: 'Chief Financial Officer (CFO)',
    description: 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations',
    email: 'leonardo@facevoice.ai',
    linkedin: 'https://linkedin.com/in/leonardo-alotta',
    image_url: '/team/Leonardo professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 7,
    name: 'Abraham Caur',
    role: 'Product Manager (PM), UX/UI Designer',
    description: 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences',
    email: 'abraham@facevoice.ai',
    linkedin: 'https://linkedin.com/in/abraham-caur',
    image_url: '/team/Abraham professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
]

// Componente per l'immagine del team member con fallback
function TeamMemberImage({ member }: { member: TeamMember }) {
  const [imageError, setImageError] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(member.image_url)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
  }

  const initials = getInitials(member.name)

  // Aggiorna l'URL quando cambia il membro
  useEffect(() => {
    setImageUrl(member.image_url)
    setImageError(false)
  }, [member.image_url])

  // Se non c'è immagine o errore, mostra placeholder
  if (!imageUrl || imageError) {
    return (
      <div className="relative w-full h-full">
        <div className="w-full h-full flex items-center justify-center bg-[var(--accent-blue)]/10">
          <span className="text-4xl font-bold text-[var(--accent-blue)]">
            {initials}
          </span>
        </div>
      </div>
    )
  }

  // Se c'è un'immagine, mostra quella
  return (
    <div className="relative w-full h-full">
      <Image
        src={imageUrl}
        alt={member.name}
        fill
        className="object-cover"
        loading="eager"
        priority
        onError={() => {
          setImageError(true)
          setImageUrl(null)
        }}
        onLoad={() => setImageError(false)}
        unoptimized
      />
    </div>
  )
}

export default function Team() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const insertingRef = useRef(false)

  useEffect(() => {
    fetchTeamMembers()
  }, [])

  const fetchTeamMembers = async () => {
    try {
      // Verifica che Supabase sia configurato
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.warn('Supabase URL not configured. Using fallback data.')
        setTeamMembers(FALLBACK_TEAM_MEMBERS)
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('team_members')
          .select('*')
          .order('id', { ascending: true })

        if (error) {
          // Log solo in sviluppo, non in produzione
          if (process.env.NODE_ENV === 'development') {
            console.warn('Error fetching team members (using fallback):', {
              message: error.message,
              code: error.code,
            })
          }
          // Usa fallback in caso di errore
          setTeamMembers(FALLBACK_TEAM_MEMBERS)
        } else if (data && data.length > 0) {
          setTeamMembers(data)
        } else {
          // Se non ci sono membri, prova a inserirli automaticamente
          if (!insertingRef.current) {
            insertingRef.current = true
            console.log('No team members found. Attempting to insert...')
            await insertTeamMembers()
            insertingRef.current = false
          } else {
            // Se l'inserimento è in corso, usa fallback temporaneamente
            setTeamMembers(FALLBACK_TEAM_MEMBERS)
          }
        }
      } catch (fetchError: any) {
        // Errore di rete o connessione (ERR_NAME_NOT_RESOLVED, etc.)
        // Log solo in sviluppo, non in produzione
        if (process.env.NODE_ENV === 'development') {
          console.warn('Network error fetching team members (using fallback):', {
            message: fetchError?.message,
            name: fetchError?.name,
          })
        }
        setTeamMembers(FALLBACK_TEAM_MEMBERS)
      }
    } catch (error: any) {
      // Log solo in sviluppo
      if (process.env.NODE_ENV === 'development') {
        console.warn('Unexpected error (using fallback):', {
          message: error?.message,
        })
      }
      // Usa fallback anche in caso di errore inatteso
      setTeamMembers(FALLBACK_TEAM_MEMBERS)
    } finally {
      setLoading(false)
    }
  }

  const insertTeamMembers = async () => {
    try {
      const response = await fetch('/api/team/reinsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const result = await response.json()
        console.log('Team members inserted:', result)
        // Ricarica i membri del team direttamente da Supabase
        const { data, error } = await supabase
          .from('team_members')
          .select('*')
          .order('id', { ascending: true })
        
        if (!error && data) {
          setTeamMembers(data)
        }
      } else {
        const error = await response.json()
        console.error('Error inserting team members:', error)
      }
    } catch (error) {
      console.error('Error calling insert API:', error)
    }
  }


  if (loading) {
    return (
      <section id="team" className="min-h-screen py-24 px-6 bg-[var(--background)]">
        <div className="container mx-auto text-center">
          <p className="text-[var(--text-secondary)] text-xl">Loading team...</p>
        </div>
      </section>
    )
  }

  return (
    <section id="team" className="min-h-screen py-24 px-6 bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto max-w-6xl"
      >
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
          Our Team
        </h2>
        <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
          Meet the talented individuals driving innovation
        </p>
        
        {teamMembers.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--text-secondary)] text-xl">No team members found.</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  whileHover={{ scale: 1.02, y: -5 }}
                  className="bg-[var(--card-background)] border border-[var(--border-color)] p-6 rounded-2xl text-center group hover:shadow-lg transition-all"
                >
                  <div className="mb-6 relative">
                    <div className="w-32 h-32 mx-auto rounded-full overflow-hidden border-2 border-[var(--border-color)] relative">
                      <TeamMemberImage member={member} />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                      {member.name}
                    </h3>
                    {member.is_contractor && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-[var(--background-secondary)] rounded-full" title="Contractor">
                        <Briefcase className="w-3 h-3 text-[var(--text-secondary)]" />
                        <span className="text-xs text-[var(--text-secondary)] font-medium">Contractor</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[var(--accent-blue)] mb-3 font-medium text-sm">{member.role}</p>
                  <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed min-h-[3rem]">
                    {member.description || `Expert in the role of ${member.role.toLowerCase()}, contributing specialized skills to the team's success.`}
                  </p>
                  <div className="flex justify-center gap-3">
                    {member.linkedin && (
                      <a
                        href={member.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 bg-[var(--background-secondary)] rounded-full hover:bg-[var(--accent-blue)]/10 transition-all"
                        aria-label="LinkedIn"
                      >
                        <Linkedin className="w-4 h-4 text-[var(--text-primary)]" />
                      </a>
                    )}
                    {member.x && (
                      <a
                        href={member.x}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 bg-[var(--background-secondary)] rounded-full hover:bg-[var(--accent-blue)]/10 transition-all"
                        aria-label="X (Twitter)"
                      >
                        <svg className="w-4 h-4 text-[var(--text-primary)]" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                      </a>
                    )}
                    {member.google && (
                      <a
                        href={member.google}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 bg-[var(--background-secondary)] rounded-full hover:bg-[var(--accent-blue)]/10 transition-all"
                        aria-label="Google"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      </a>
                    )}
                    {member.instagram && (
                      <a
                        href={member.instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 bg-[var(--background-secondary)] rounded-full hover:bg-[var(--accent-blue)]/10 transition-all"
                        aria-label="Instagram"
                      >
                        <Instagram className="w-4 h-4 text-[var(--text-primary)]" />
                      </a>
                    )}
                    {member.email && (
                      <a
                        href={`mailto:${member.email}`}
                        className="p-2 bg-[var(--background-secondary)] rounded-full hover:bg-[var(--accent-blue)]/10 transition-all"
                        aria-label="Email"
                      >
                        <Mail className="w-4 h-4 text-[var(--text-primary)]" />
                      </a>
                    )}
                  </div>
                  {member.is_contractor && (
                    <p className="text-[8px] text-[var(--text-secondary)]/60 mt-2 opacity-50">
                      AI Generated
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </section>
  )
}
