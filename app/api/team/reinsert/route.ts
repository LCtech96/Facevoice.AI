import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Usa SERVICE_ROLE_KEY per bypassare RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const teamMembers = [
  {
    name: 'Luca Corrao',
    role: 'CEO & Founder',
    description: 'Visionary leader with expertise in AI and blockchain technologies',
    email: 'luca@facevoice.ai',
    linkedin: 'https://linkedin.com/in/luca-corrao',
    image_url: '/team/Luca professionale fv.png',
  },
  {
    name: 'Sevara Urmanaeva',
    role: 'CMO',
    description: 'Strategic marketing expert driving brand growth and digital innovation',
    email: 'sevara@facevoice.ai',
    linkedin: 'https://linkedin.com/in/sevara-urmanaeva',
    image_url: '/team/Sevara professionale fv.png',
  },
  {
    name: 'Giuseppe Delli Paoli',
    role: 'AI & Automation Specialist',
    description: 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology',
    email: null,
    linkedin: null,
    image_url: '/team/Giuseppe professionale fv.png',
  },
  {
    name: 'Sara Siddique',
    role: 'Data Engineer, Data Scientist',
    description: 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights',
    email: 'sara@facevoice.ai',
    linkedin: 'https://linkedin.com/in/sara-siddique',
    image_url: '/team/Sara professionale fv.png',
  },
  {
    name: 'John Mcnova',
    role: 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)',
    description: 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems',
    email: 'jonh@facevoice.ai',
    linkedin: 'https://linkedin.com/in/jonh-mcnova',
    image_url: '/team/Jonh professionale fv.png',
  },
  {
    name: 'Leonardo Alotta',
    role: 'Chief Financial Officer (CFO)',
    description: 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations',
    email: 'leonardo@facevoice.ai',
    linkedin: 'https://linkedin.com/in/leonardo-alotta',
    image_url: '/team/Leonardo professionale fv.png',
  },
  {
    name: 'Abraham Caur',
    role: 'Product Manager (PM), UX/UI Designer',
    description: 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences',
    email: 'abraham@facevoice.ai',
    linkedin: 'https://linkedin.com/in/abraham-caur',
    image_url: '/team/Abraham professionale fv.png',
  },
  {
    name: 'Umberto (alias Fischietto)',
    role: 'Director of Digital Strategy',
    description: 'Director of Digital Strategy social media, content creator.',
    email: null,
    linkedin: null,
    image_url: '/team/Umberto-Facevoice.png',
  },
  {
    name: 'Michael',
    role: 'Team Member',
    description: 'Member of the Facevoice AI team.',
    email: null,
    linkedin: null,
    image_url: '/team/Michael professionale fv.png',
  },
  {
    name: 'Katreen',
    role: 'Team Member',
    description: 'Member of the Facevoice AI team.',
    email: null,
    linkedin: null,
    image_url: '/team/Katreen professionale fv.png',
  },
]

export async function POST(request: NextRequest) {
  try {
    const results = []
    const errors = []

    // Inserisci ogni membro del team individualmente per gestire meglio i conflitti
    for (const member of teamMembers) {
      // Prima verifica se esiste già
      const { data: existing } = await supabase
        .from('team_members')
        .select('id, name')
        .eq('name', member.name)
        .single()

      if (existing) {
        // Aggiorna il membro esistente
        const { data, error } = await supabase
          .from('team_members')
          .update({
            role: member.role,
            description: member.description,
            email: member.email,
            linkedin: member.linkedin,
            image_url: member.image_url,
            updated_at: new Date().toISOString(),
          })
          .eq('name', member.name)
          .select()
          .single()

        if (error) {
          errors.push({ member: member.name, error: error.message })
        } else {
          results.push(data)
        }
      } else {
        // Inserisci nuovo membro
        const { data, error } = await supabase
          .from('team_members')
          .insert(member)
          .select()
          .single()

        if (error) {
          errors.push({ member: member.name, error: error.message })
        } else {
          results.push(data)
        }
      }
    }

    if (errors.length > 0) {
      console.error('Errors inserting team members:', errors)
      return NextResponse.json(
        { 
          success: true,
          message: `${results.length} membri inseriti/aggiornati, ${errors.length} errori`,
          data: results,
          errors,
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${results.length} membri del team inseriti/aggiornati con successo`,
      data: results,
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server', details: error.message },
      { status: 500 }
    )
  }
}

