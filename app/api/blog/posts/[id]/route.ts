import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const isAdminRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return data.user?.email === 'luca@facevoice.ai'
}

// Funzione per verificare se una stringa è un UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // Se è un UUID, cerca per ID
    if (isUUID(id)) {
      const { data, error } = await supabaseAdmin
        .from('blog_posts')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Error fetching post:', error)
        return NextResponse.json(
          { error: 'Post non trovato' },
          { status: 404 }
        )
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Post non trovato' },
          { status: 404 }
        )
      }

      return NextResponse.json({ post: data })
    }
    
    // Altrimenti è uno slug, cerca per slug
    const { data: allPosts, error } = await supabaseAdmin
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

    if (!allPosts || allPosts.length === 0) {
      return NextResponse.json(
        { error: 'Nessun post trovato' },
        { status: 404 }
      )
    }

    // Cerca il post che corrisponde allo slug
    // Prima cerca per campo slug (più veloce e preciso)
    const normalizedId = id.toLowerCase().trim()
    
    const postBySlug = allPosts.find((p: any) => {
      if (p.slug) {
        return p.slug.toLowerCase().trim() === normalizedId
      }
      return false
    })

    if (postBySlug) {
      return NextResponse.json({ post: postBySlug })
    }

    // Se non trova per slug, cerca per slug generato dal titolo (fallback)
    const post = allPosts.find((p: any) => {
      const postSlug = generateSlug(p.title || '')
      return postSlug.toLowerCase().trim() === normalizedId
    })

    if (post) {
      return NextResponse.json({ post })
    }

    // Log dettagliato per debug
    console.error('❌ Post non trovato per slug:', normalizedId)
    console.log('📋 Post disponibili nel database:')
    allPosts.forEach((p: any) => {
      const postSlug = p.slug || generateSlug(p.title || '')
      console.log(`  - ID: ${p.id}`)
      console.log(`    Titolo: ${p.title}`)
      console.log(`    Slug DB: ${p.slug || '(non presente)'}`)
      console.log(`    Slug generato: ${postSlug}`)
      console.log(`    Match: ${postSlug.toLowerCase().trim() === normalizedId ? '✅' : '❌'}`)
    })
    
    return NextResponse.json(
      { 
        error: 'Post non trovato',
        debug: {
          searchedSlug: normalizedId,
          availablePosts: allPosts.map((p: any) => ({
            id: p.id,
            title: p.title,
            slug: p.slug || generateSlug(p.title || '')
          }))
        }
      },
      { status: 404 }
    )

    return NextResponse.json({ post })
  } catch (error: any) {
    console.error('Error in GET /api/blog/posts/[id]:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare il post' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isAdminRequest(request))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { id } = await params
    
    // Cerca il post per ID o slug
    let postId = id
    
    if (!isUUID(id)) {
      // Se non è un UUID, cerca per slug
      const { data: allPosts } = await supabaseAdmin
        .from('blog_posts')
        .select('id, slug')
        .order('created_at', { ascending: false })
      
      const normalizedId = id.toLowerCase().trim()
      const post = allPosts?.find((p: any) => {
        const postSlug = p.slug || generateSlug(p.title || '')
        return postSlug.toLowerCase().trim() === normalizedId
      })
      
      if (!post) {
        return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
      }
      
      postId = post.id
    }

    const { error } = await supabaseAdmin
      .from('blog_posts')
      .delete()
      .eq('id', postId)

    if (error) {
      console.error('Error deleting post:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in DELETE /api/blog/posts/[id]:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nell\'eliminazione del post' },
      { status: 500 }
    )
  }
}
