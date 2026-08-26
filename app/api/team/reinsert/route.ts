import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Usa SERVICE_ROLE_KEY per bypassare RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key')

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
    name: 'Monia Cumbo',
    role: 'Content Creator & Social Media Manager',
    description:
      'Laureata in Marketing e Comunicazione, eccelle nella creazione di contenuti e nella gestione dei social media.',
    email: null,
    linkedin: null,
    instagram: 'https://www.instagram.com/monia_cumbo',
    image_url: '/team/Monia professionale fv.png',
  },
  {
    name: 'Umberto (alias Fischietto)',
    role: 'Content Creator',
    description: 'Content creator specializzato in social media e strategia digitale.',
    email: null,
    linkedin: null,
    image_url: '/team/Umberto-Facevoice.png',
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
    name: 'Giuseppe Delli Paoli',
    role: 'AI & Automation Specialist',
    description: 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology',
    email: null,
    linkedin: null,
    image_url: '/team/Giuseppe professionale fv.png',
  },
]

const removedTeamMembers = [
  'John Mcnova',
  'Jonh Mcnova',
  'Abraham Caur',
  'Michael',
  'Sara Siddique',
  'Katreen',
]

export async function POST(request: NextRequest) {
  try {
    const results = []
    const errors = []

    for (const name of removedTeamMembers) {
      const { error } = await supabase.from('team_members').delete().eq('name', name)
      if (error) {
        errors.push({ member: name, error: error.message, action: 'delete' })
      }
    }

    for (const member of teamMembers) {
      const { data: existing } = await supabase
        .from('team_members')
        .select('id, name')
        .eq('name', member.name)
        .single()

      if (existing) {
        const { data, error } = await supabase
          .from('team_members')
          .update({
            role: member.role,
            description: member.description,
            email: member.email,
            linkedin: member.linkedin,
            instagram: 'instagram' in member ? member.instagram : undefined,
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
