import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Funzione helper per generare slug da titolo
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    
    // Cerca prima per slug esatto se esiste un campo slug
    // Altrimenti cerca per slug generato dal titolo
    const { data: allPosts, error } = await supabase
      .from('blog_posts')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching posts:', error)
      return NextResponse.json(
        { error: 'Errore nel recuperare i post' },
        { status: 500 }
      )
    }

    // Cerca il post che corrisponde allo slug (per titolo convertito o campo slug se esiste)
    const post = allPosts?.find((p: any) => {
      const postSlug = p.slug || generateSlug(p.title)
      return postSlug === slug
    })

    if (!post) {
      return NextResponse.json(
        { error: 'Post non trovato' },
        { status: 404 }
      )
    }

    return NextResponse.json({ post })
  } catch (error: any) {
    console.error('Error in GET /api/blog/posts/slug/[slug]:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare il post' },
      { status: 500 }
    )
  }
}
