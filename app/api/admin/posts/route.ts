import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin-auth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key')

/** null = non autorizzato; altrimenti l'email dell'admin autenticato. */
const getAdminEmail = async (req: NextRequest): Promise<string | null> => {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data } = await supabaseAuth.auth.getUser(token)
  return isAdminEmail(data.user?.email) ? data.user!.email! : null
}

const VALID_PLATFORMS = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x']

/**
 * CRUD per il calendario editoriale. Qui non c'e' nessuna pubblicazione
 * automatica: senza un canale collegato non esiste un'API a cui
 * mandare il post, quindi uno "scheduled" resta in attesa finche' non
 * nasce quell'integrazione. E' pensato per preparare i contenuti in
 * anticipo, non per pubblicarli da solo oggi.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await getAdminEmail(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('scheduled_posts')
      .select('*')
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ posts: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare i post' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminEmail = await getAdminEmail(req)
    if (!adminEmail) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const body = await req.json()
    const caption: string = String(body?.caption || '').trim()
    const platforms: string[] = Array.isArray(body?.platforms)
      ? body.platforms.filter((p: unknown) => typeof p === 'string' && VALID_PLATFORMS.includes(p))
      : []
    const mediaUrls: string[] = Array.isArray(body?.media_urls)
      ? body.media_urls.filter((u: unknown) => typeof u === 'string' && u.trim())
      : []
    const scheduledAt: string | null = body?.scheduled_at || null

    if (!caption && mediaUrls.length === 0) {
      return NextResponse.json({ error: 'Il post non puo’ essere vuoto' }, { status: 400 })
    }
    if (platforms.length === 0) {
      return NextResponse.json({ error: 'Seleziona almeno una piattaforma' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('scheduled_posts')
      .insert({
        platforms,
        caption,
        media_urls: mediaUrls,
        scheduled_at: scheduledAt,
        // Senza una data futura non c'e' niente da "programmare": resta
        // una bozza finche' non se ne imposta una.
        status: scheduledAt ? 'scheduled' : 'draft',
        created_by: adminEmail,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ post: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nella creazione del post' },
      { status: 500 }
    )
  }
}
