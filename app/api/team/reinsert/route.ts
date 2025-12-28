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
    role: 'Co-founder, AI & Automation Specialist',
    description: 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology',
    email: 'giuseppe@facevoice.ai',
    linkedin: 'https://linkedin.com/in/giuseppe-delli-paoli',
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
    name: 'Jonh Mcnova',
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
]

export async function POST(request: NextRequest) {
  try {
    // Prima elimina tutti i membri esistenti (opzionale - commenta se vuoi solo aggiungere)
    // const { error: deleteError } = await supabase
    //   .from('team_members')
    //   .delete()
    //   .neq('id', 0) // Elimina tutti
    
    // if (deleteError) {
    //   console.error('Error deleting team members:', deleteError)
    // }

    // Inserisci i membri del team
    const { data, error } = await supabase
      .from('team_members')
      .upsert(teamMembers, {
        onConflict: 'name', // Usa 'name' come chiave unica, oppure aggiungi un campo unico nella tabella
        ignoreDuplicates: false, // Se true, ignora i duplicati; se false, li aggiorna
      })
      .select()

    if (error) {
      console.error('Error inserting team members:', error)
      return NextResponse.json(
        { error: 'Errore nell\'inserimento dei membri del team', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `${data?.length || teamMembers.length} membri del team inseriti/aggiornati con successo`,
      data,
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server', details: error.message },
      { status: 500 }
    )
  }
}

