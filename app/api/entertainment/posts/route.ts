import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Funzione per generare slug da titolo
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Funzione per generare slug unico
async function generateUniqueSlug(baseSlug: string, supabase: any): Promise<string> {
  let slug = baseSlug
  let counter = 1
  
  while (true) {
    const { data } = await supabase
      .from('entertainment_posts')
      .select('id')
      .eq('slug', slug)
      .limit(1)
    
    if (!data || data.length === 0) {
      return slug
    }
    
    slug = `${baseSlug}-${counter}`
    counter++
  }
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('entertainment_posts')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ posts: data || [] })
  } catch (error: any) {
    console.error('Error fetching entertainment posts:', error)
    return NextResponse.json({ posts: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, content, image_url } = await req.json()

    if (!title || !content) {
      return NextResponse.json({ error: 'Titolo e contenuto obbligatori' }, { status: 400 })
    }

    // Genera slug dal titolo
    const baseSlug = generateSlug(title.trim())
    const slug = await generateUniqueSlug(baseSlug, supabaseAdmin)

    const { data, error } = await supabaseAdmin
      .from('entertainment_posts')
      .insert({
        title: title.trim(),
        content: content.trim(),
        image_url: image_url?.trim() || null,
        author: 'Fischietto',
        slug: slug,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, post: data })
  } catch (error: any) {
    console.error('Error creating entertainment post:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel pubblicare il post' },
      { status: 500 }
    )
  }
}
