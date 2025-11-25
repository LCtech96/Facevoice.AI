'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Linkedin, Mail, Instagram, Twitter, Briefcase } from 'lucide-react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

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
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500/10 to-blue-500/5">
          <span className="text-6xl font-bold text-coral-red">
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

  useEffect(() => {
    fetchTeamMembers()
  }, [])

  const fetchTeamMembers = async () => {
    try {
      // Verifica che Supabase sia configurato
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.warn('Supabase URL not configured. Using fallback data.')
        setTeamMembers([])
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('id', { ascending: true })

      if (error) {
        console.error('Error fetching team members:', error)
        setTeamMembers([])
      } else {
        setTeamMembers(data || [])
      }
    } catch (error) {
      console.error('Unexpected error:', error)
      setTeamMembers([])
    } finally {
      setLoading(false)
    }
  }


  if (loading) {
    return (
      <section id="team" className="min-h-screen py-24 px-6 relative">
        <div className="container mx-auto text-center">
          <p className="text-coral-red-light text-xl">Loading team...</p>
        </div>
      </section>
    )
  }

  return (
    <section id="team" className="min-h-screen py-24 px-6 relative">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto"
      >
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-4 gradient-text">
          Our Team
        </h2>
        <p className="text-xl text-coral-red-light text-center mb-16 max-w-2xl mx-auto">
          Meet the talented individuals driving innovation
        </p>
        
        {teamMembers.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-coral-red/70 text-xl">No team members found.</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  whileHover={{ scale: 1.05 }}
                  className="glass-strong p-8 rounded-2xl text-center group"
                >
                  <div className="mb-6 relative">
                    <div className="w-48 h-48 mx-auto rounded-full overflow-hidden glass border-4 border-coral-red/30 group-hover:border-coral-red transition-colors relative">
                      <TeamMemberImage member={member} />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <h3 className="text-2xl font-bold text-coral-red-light">
                      {member.name}
                    </h3>
                    {member.is_contractor && (
                      <div className="flex items-center gap-1 px-2 py-1 glass rounded-full" title="Contractor">
                        <Briefcase className="w-4 h-4 text-coral-red" />
                        <span className="text-xs text-coral-red font-semibold">Contractor</span>
                      </div>
                    )}
                  </div>
                  <p className="text-coral-red mb-4 font-semibold">{member.role}</p>
                  <p className="text-coral-red/70 mb-6 text-sm leading-relaxed min-h-[3rem]">
                    {member.description || `Expert in the role of ${member.role.toLowerCase()}, contributing specialized skills to the team's success.`}
                  </p>
                  <div className="flex justify-center gap-4">
                    {member.linkedin && (
                      <a
                        href={member.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 glass rounded-full hover:glass-strong transition-all"
                        aria-label="LinkedIn"
                      >
                        <Linkedin className="w-5 h-5 text-coral-red" />
                      </a>
                    )}
                    {member.x && (
                      <a
                        href={member.x}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 glass rounded-full hover:glass-strong transition-all"
                        aria-label="X (Twitter)"
                      >
                        <svg className="w-5 h-5 text-coral-red" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                      </a>
                    )}
                    {member.google && (
                      <a
                        href={member.google}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3 glass rounded-full hover:glass-strong transition-all"
                        aria-label="Google"
                      >
                        <svg className="w-5 h-5 text-coral-red" viewBox="0 0 24 24" fill="currentColor">
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
                        className="p-3 glass rounded-full hover:glass-strong transition-all"
                        aria-label="Instagram"
                      >
                        <Instagram className="w-5 h-5 text-coral-red" />
                      </a>
                    )}
                    {member.email && (
                      <a
                        href={`mailto:${member.email}`}
                        className="p-3 glass rounded-full hover:glass-strong transition-all"
                        aria-label="Email"
                      >
                        <Mail className="w-5 h-5 text-coral-red" />
                      </a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </section>
  )
}
