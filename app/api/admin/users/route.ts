import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin-auth'
import { accessStatuses, allDisabledModels } from '@/lib/chat-access'

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

export async function GET(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    // listUsers e' paginato: senza il ciclo ci fermeremmo alla prima pagina
    // e il totale mostrato nel pannello sarebbe sbagliato per difetto.
    const PER_PAGE = 200
    const MAX_PAGES = 100 // 20.000 utenti: limite di sicurezza contro loop infiniti
    const allUsers = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      allUsers.push(...data.users)

      // Ultima pagina: meno risultati del richiesto.
      if (data.users.length < PER_PAGE) break
    }

    // Stato della chat interna: abilitato, richiesta in attesa, rifiutata.
    const statuses = await accessStatuses().catch(() => new Map())
    const disabled = await allDisabledModels().catch(() => new Map<string, string[]>())
    return NextResponse.json({
      users: allUsers
        .map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          chat_status: statuses.get(user.id) ?? null,
          disabled_models: disabled.get(user.id) ?? [],
        }))
        // Le richieste in attesa in cima.
        .sort((a, b) => Number(b.chat_status === 'pending') - Number(a.chat_status === 'pending')),
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Errore nel recuperare gli utenti' },
      { status: 500 }
    )
  }
}
