import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key')

const isAdminRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return isAdminEmail(data.user?.email)
}

const VALID_PLATFORMS = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (typeof body?.caption === 'string') {
      updates.caption = body.caption.trim()
    }
    if (Array.isArray(body?.platforms)) {
      updates.platforms = body.platforms.filter(
        (p: unknown) => typeof p === 'string' && VALID_PLATFORMS.includes(p)
      )
    }
    if (Array.isArray(body?.media_urls)) {
      updates.media_urls = body.media_urls.filter((u: unknown) => typeof u === 'string' && u.trim())
    }
    if ('scheduled_at' in (body || {})) {
      updates.scheduled_at = body.scheduled_at || null
      // Rimettere o togliere una data riporta coerente lo stato, a meno
      // che il post non sia gia' stato pubblicato o annullato.
      if (!['published', 'canceled', 'failed'].includes(body.currentStatus)) {
        updates.status = updates.scheduled_at ? 'scheduled' : 'draft'
      }
    }
    if (body?.status === 'canceled') {
      updates.status = 'canceled'
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('scheduled_posts')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })
    }

    return NextResponse.json({ post: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nell\'aggiornamento del post' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { id } = await params
    const { error } = await supabaseAdmin.from('scheduled_posts').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nell\'eliminazione' },
      { status: 500 }
    )
  }
}
