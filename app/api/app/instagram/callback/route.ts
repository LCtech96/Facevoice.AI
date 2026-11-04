import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyState } from '@/lib/saas/meta'
import { connectInstagramFromCode } from '@/lib/saas/instagram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Ritorno dal login di Instagram: si salva l'account nello spazio indicato dallo
// stato firmato, poi si torna alla pagina dei canali.

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const back = (query: Record<string, string>) => NextResponse.redirect(new URL(`/app/canali/meta?${new URLSearchParams(query)}`, req.nextUrl.origin))

  if (params.get('error')) return back({ error: 'Collegamento annullato.' })
  const state = verifyState(params.get('state'))
  const code = params.get('code')
  if (!state || !code) return back({ error: 'Collegamento scaduto, riprova.' })

  // Lo stato e' firmato, ma si ricontrolla che la persona sia ancora amministratore dello spazio.
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', state.workspaceId)
    .eq('user_id', state.userId)
    .maybeSingle()
  if (!member || member.role === 'member') return back({ error: 'Non hai i permessi per collegare i canali di questo spazio.' })

  try {
    const result = await connectInstagramFromCode(req.nextUrl.origin, code, state.workspaceId, state.userId)
    if (result.skipped) return back({ error: `Instagram non collegato: ${result.skipped}` })
    return back({ ok: result.username || 'Instagram' })
  } catch (error) {
    console.error('instagram callback:', error instanceof Error ? error.message : error)
    return back({ error: 'Collegamento di Instagram non riuscito, riprova.' })
  }
}
