'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Linkedin, Mail, Instagram, Twitter, Briefcase } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase-client'
import { useTranslation } from '@/lib/i18n/LanguageContext'

interface TeamMember {
  id: number
  name: string
  role: string
  role_subtitle?: string | null
  image_url: string | null
  description: string | null
  email: string | null
  linkedin: string | null
  instagram: string | null
  x: string | null
  google: string | null
  is_contractor: boolean | null
}

// Fallback data quando Supabase non è disponibile (solo membri richiesti)
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
    name: 'Monia Cumbo',
    role: 'Content Creator & Social Media Manager',
    description:
      'Graduate in Marketing and Communication, she excels in content creation and social media management.',
    email: null,
    linkedin: null,
    image_url: '/team/Monia professionale fv.png',
    instagram: 'https://www.instagram.com/monia_cumbo',
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 4,
    name: 'Umberto (alias Fischietto)',
    role: 'Content Creator',
    description: 'Content creator specializzato in social media e strategia digitale.',
    email: null,
    linkedin: null,
    image_url: '/team/Umberto-Facevoice.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 5,
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
    id: 6,
    name: 'Giuseppe Paoli',
    role: 'AI & Automation Specialist',
    description: 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology',
    email: null,
    linkedin: null,
    image_url: '/team/Giuseppe professionale fv.png',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 7,
    name: 'Jacob Rodriguez',
    role: 'Software Engineer J',
    role_subtitle: 'FL',
    description:
      'Software engineer based in Florida, focused on building reliable web applications and contributing to Facevoice AI with a collaborative, team-first mindset.',
    email: null,
    linkedin: null,
    image_url: '/team/jacob-rodriguez-2026.jpg',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
  {
    id: 8,
    name: 'Francesco Troia',
    role: 'Client Success Manager',
    description:
      'With a warm smile and a genuine focus on people, Francesco makes every client feel heard—turning first conversations into lasting, successful partnerships with Facevoice AI.',
    email: null,
    linkedin: null,
    image_url: '/team/francesco-troia.jpg',
    instagram: null,
    x: null,
    google: null,
    is_contractor: false,
  },
]

type TeamOrderEntry = {
  key: string
  aliases?: string[]
  displayName?: string
  role?: string
  roleSubtitle?: string | null
  linkedin?: string | null
}

const EXECUTIVE_KEYS = new Set([
  'luca corrao',
  'sevara urmanaeva',
  'leonardo alotta',
])

const TEAM_ORDER: TeamOrderEntry[] = [
  { key: 'luca corrao', displayName: 'Luca Corrao' },
  { key: 'sevara urmanaeva', displayName: 'Sevara Urmanaeva', role: 'CMO' },
  { key: 'leonardo alotta', displayName: 'Leonardo Alotta' },
  { key: 'monia cumbo', displayName: 'Monia Cumbo' },
  { key: 'umberto (alias fischietto)', displayName: 'Umberto (alias Fischietto)', role: 'Content Creator' },
  {
    key: 'giuseppe paoli',
    aliases: ['giuseppe delli paoli'],
    displayName: 'Giuseppe Paoli',
    role: 'AI & Automation Specialist',
    linkedin: null,
  },
  {
    key: 'jacob rodriguez',
    aliases: ['jacob rodriguez j'],
    displayName: 'Jacob Rodriguez',
    role: 'Software Engineer J',
    roleSubtitle: 'FL',
  },
  {
    key: 'francesco troia',
    displayName: 'Francesco Troia',
    role: 'Client Success Manager',
  },
]

const MEMBER_TRANSLATION_KEYS: Record<string, { role?: string; description?: string }> = {
  'monia cumbo': {
    role: 'team.members.monia.role',
    description: 'team.members.monia.description',
  },
}

const getMemberRole = (
  member: TeamMember,
  t: (key: string) => string
): string => {
  const keys = MEMBER_TRANSLATION_KEYS[normalizeTeamName(member.name)]
  if (keys?.role) return t(keys.role)
  return member.role
}

const getMemberDescription = (
  member: TeamMember,
  t: (key: string) => string
): string => {
  const keys = MEMBER_TRANSLATION_KEYS[normalizeTeamName(member.name)]
  if (keys?.description) return t(keys.description)
  return (
    member.description ||
    `Expert in the role of ${member.role.toLowerCase()}, contributing specialized skills to the team's success.`
  )
}

const normalizeTeamName = (name: string) =>
  name.toLowerCase().replace(/\s+/g, ' ').trim()

const applyTeamOrdering = (members: TeamMember[]) => {
  const byName = new Map<string, TeamMember>()

  members.forEach((member) => {
    const key = normalizeTeamName(member.name)
    if (!byName.has(key)) {
      byName.set(key, member)
    }
  })

  const ordered: TeamMember[] = []

  TEAM_ORDER.forEach((entry, index) => {
    const lookupKeys = [entry.key, ...(entry.aliases || [])]
    const matchedKey = lookupKeys.find((key) => byName.has(key))
    const candidate = matchedKey ? byName.get(matchedKey) : undefined

    if (candidate) {
      ordered.push({
        ...candidate,
        id: index + 1,
        name: entry.displayName || candidate.name,
        role: entry.role || candidate.role,
        role_subtitle:
          entry.roleSubtitle !== undefined ? entry.roleSubtitle : candidate.role_subtitle,
        linkedin: entry.linkedin !== undefined ? entry.linkedin : candidate.linkedin,
      })
    }
  })

  return ordered
}

function isExecutiveMember(member: TeamMember) {
  return EXECUTIVE_KEYS.has(normalizeTeamName(member.name))
}

function TeamMemberCard({
  member,
  index,
  t,
  featured = false,
}: {
  member: TeamMember
  index: number
  t: (key: string) => string
  featured?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.1 }}
      whileHover={{ scale: 1.02, y: -5 }}
      className={`bg-[var(--card-background)] border border-[var(--border-color)] p-6 rounded-2xl text-center group hover:shadow-lg transition-all ${
        featured ? 'md:p-8' : ''
      }`}
    >
      <div className="mb-6 relative">
        <div
          className={`mx-auto rounded-full overflow-hidden border-2 border-[var(--border-color)] relative ${
            featured ? 'w-40 h-40' : 'w-32 h-32'
          }`}
        >
          <TeamMemberImage member={member} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 mb-2">
        <h3
          className={`font-semibold text-[var(--text-primary)] ${
            featured ? 'text-2xl' : 'text-xl'
          }`}
        >
          {member.name}
        </h3>
        {member.is_contractor && (
          <div
            className="flex items-center gap-1 px-2 py-1 bg-[var(--background-secondary)] rounded-full"
            title="Contractor"
          >
            <Briefcase className="w-3 h-3 text-[var(--text-secondary)]" />
            <span className="text-xs text-[var(--text-secondary)] font-medium">
              Contractor
            </span>
          </div>
        )}
      </div>
      <div className="mb-3">
        <p className="text-[var(--accent-blue)] font-medium text-sm">
          {getMemberRole(member, t)}
        </p>
        {member.role_subtitle && (
          <p className="text-[var(--text-secondary)] text-xs mt-1 tracking-wide">
            {member.role_subtitle}
          </p>
        )}
      </div>
      <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed min-h-[3rem]">
        {getMemberDescription(member, t)}
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
            <svg
              className="w-4 h-4 text-[var(--text-primary)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
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
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
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
  )
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
        alt={`${member.name} - Team Facevoice AI - ${member.role || 'Sviluppatore Software e Consulente AI'}`}
        fill
        className="object-cover"
        loading="lazy"
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
  const { t } = useTranslation()

  useEffect(() => {
    fetchTeamMembers()
  }, [])

  const fetchTeamMembers = async () => {
    try {
      // Verifica che Supabase sia configurato
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.warn('Supabase URL not configured. Using fallback data.')
        setTeamMembers(applyTeamOrdering(FALLBACK_TEAM_MEMBERS))
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
          setTeamMembers(applyTeamOrdering(FALLBACK_TEAM_MEMBERS))
        } else if (data && data.length > 0) {
          const mergedMembers = [...data, ...FALLBACK_TEAM_MEMBERS]
          setTeamMembers(applyTeamOrdering(mergedMembers))
        } else {
          // Se non ci sono membri, prova a inserirli automaticamente
          if (!insertingRef.current) {
            insertingRef.current = true
            console.log('No team members found. Attempting to insert...')
            await insertTeamMembers()
            insertingRef.current = false
          } else {
            // Se l'inserimento è in corso, usa fallback temporaneamente
            setTeamMembers(applyTeamOrdering(FALLBACK_TEAM_MEMBERS))
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
        setTeamMembers(applyTeamOrdering(FALLBACK_TEAM_MEMBERS))
      }
    } catch (error: any) {
      // Log solo in sviluppo
      if (process.env.NODE_ENV === 'development') {
        console.warn('Unexpected error (using fallback):', {
          message: error?.message,
        })
      }
      // Usa fallback anche in caso di errore inatteso
      setTeamMembers(applyTeamOrdering(FALLBACK_TEAM_MEMBERS))
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
          const mergedMembers = [...data, ...FALLBACK_TEAM_MEMBERS]
          setTeamMembers(applyTeamOrdering(mergedMembers))
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
          <p className="text-[var(--text-secondary)] text-xl">{t('team.loading')}</p>
        </div>
      </section>
    )
  }

  const executiveMembers = teamMembers.filter(isExecutiveMember)
  const coreTeamMembers = teamMembers.filter((member) => !isExecutiveMember(member))

  return (
    <section id="team" className="min-h-screen py-24 px-6 bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto max-w-6xl"
      >
        {teamMembers.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[var(--text-secondary)] text-xl">No team members found.</p>
          </div>
        ) : (
          <div className="space-y-20">
            {executiveMembers.length > 0 && (
              <div id="team-executive">
                <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
                  {t('team.executiveTitle')}
                </h2>
                <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
                  {t('team.executiveSubtitle')}
                </p>
                <div className="flex justify-center">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
                    {executiveMembers.map((member, index) => (
                      <TeamMemberCard
                        key={member.id}
                        member={member}
                        index={index}
                        t={t}
                        featured
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {coreTeamMembers.length > 0 && (
              <div id="team-members">
                <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
                  {t('team.title')}
                </h2>
                <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
                  {t('team.subtitle')}
                </p>
                <div className="flex justify-center">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl w-full">
                    {coreTeamMembers.map((member, index) => (
                      <TeamMemberCard
                        key={member.id}
                        member={member}
                        index={index}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </section>
  )
}
