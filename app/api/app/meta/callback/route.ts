import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { connectFromCode, verifyState } from '@/lib/saas/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Ritorno dal login di Meta: si salvano Pagine e Instagram scelti dal cliente
// nello spazio indicato dallo stato firmato, poi si torna alla pagina dei canali.

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const back = (query: Record<string, string>) => NextResponse.redirect(new URL(`/app/canali/meta?${new URLSearchParams(query)}`, req.nextUrl.origin))

  if (params.get('error')) return back({ error: 'Collegamento annullato.' })
  const state = verifyState(params.get('state'))
  const code = params.get('code')
  if (!state || !code) return back({ error: 'Collegamento scaduto, riprova.' })

  // Lo stato e' firmato, ma si ricontrolla che la persona sia ancora membro dello spazio.
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', state.workspaceId)
    .eq('user_id', state.userId)
    .maybeSingle()
  if (!member || member.role === 'member') return back({ error: 'Non hai i permessi per collegare i canali di questo spazio.' })

  try {
    const result = await connectFromCode(req.nextUrl.origin, code, state.workspaceId, state.userId)
    if (!result.pages.length) {
      return back({ error: result.skipped.length ? `Nessuna Pagina collegata: ${result.skipped.join(', ')}` : 'Non hai scelto nessuna Pagina: riprova e seleziona la tua Pagina.' })
    }
    return back({ ok: [...result.pages, ...result.instagram].join(', '), ...(result.skipped.length ? { skipped: result.skipped.join(', ') } : {}) })
  } catch (error) {
    console.error('meta callback:', error instanceof Error ? error.message : error)
    return back({ error: 'Collegamento non riuscito, riprova.' })
  }
}
