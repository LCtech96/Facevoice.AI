import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { canAccess, getStaffAccess } from '@/lib/staff-access'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key')


// Admin, oppure dipendente con il permesso su "Canali e AI" (vedere / modificare).
const isAdminRequest = async (req: NextRequest, cap: 'view' | 'edit' = 'edit') =>
  canAccess(await getStaffAccess(req), 'control', cap)

export async function GET(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req, 'view'))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('ai_knowledge')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare la conoscenza AI' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { title, content, category } = await req.json()

    if (!title || !content) {
      return NextResponse.json(
        { error: 'Titolo e contenuto sono obbligatori' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('ai_knowledge')
      .insert({
        title: title.trim(),
        content: content.trim(),
        category: category?.trim() || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel creare la conoscenza AI' },
      { status: 500 }
    )
  }
}
