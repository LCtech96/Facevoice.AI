import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { title, content, image_url } = await req.json()

    if (!title || !content) {
      return NextResponse.json({ error: 'Titolo e contenuto obbligatori' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .insert({
        title: title.trim(),
        content: content.trim(),
        image_url: image_url?.trim() || null,
        author: 'Facevoice.ai',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, post: data })
  } catch (error: any) {
    console.error('Error creating post:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel pubblicare il post' },
      { status: 500 }
    )
  }
}

