import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { analyzeLead, type Lead } from '@/lib/leads'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Legge il sito dell'attivita' e prepara analisi e bozze di primo contatto. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const { id } = await params
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
  try {
    return NextResponse.json({ lead: await analyzeLead(lead as Lead) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Analisi non riuscita' }, { status: 502 })
  }
}
