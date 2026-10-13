import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminEmail } from '@/lib/admin-auth'
import { cleanPermissions, hasCap, type StaffPage, type StaffPermissions } from '@/lib/staff-pages'

// Chi puo' usare le pagine del gestionale: l'admin sempre e tutto; un dipendente
// (membro attivo della chat interna) solo le pagine e le azioni che l'admin gli
// ha dato. Permessi in app_settings: staff_access:<userId>. L'identita' viene
// sempre dal token, mai dal body.

const KEY = 'staff_access:'

export type StaffAccess = {
  userId: string
  email: string
  isAdmin: boolean
  permissions: StaffPermissions
}

async function userFromRequest(req: NextRequest) {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const { data } = await supabaseAdmin.auth.getUser(header.slice(7).trim())
  return data.user ?? null
}

export async function getPermissions(userId: string): Promise<StaffPermissions> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${KEY}${userId}`).maybeSingle()
  try {
    return cleanPermissions(data?.value ? JSON.parse(data.value) : {})
  } catch {
    return {}
  }
}

export async function setPermissions(userId: string, input: unknown): Promise<StaffPermissions> {
  const permissions = cleanPermissions(input)
  if (!Object.keys(permissions).length) {
    await supabaseAdmin.from('app_settings').delete().eq('key', `${KEY}${userId}`)
  } else {
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: `${KEY}${userId}`, value: JSON.stringify(permissions), updated_at: new Date().toISOString() })
  }
  return permissions
}

export async function allPermissions(): Promise<Map<string, StaffPermissions>> {
  const { data } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${KEY}%`)
  const map = new Map<string, StaffPermissions>()
  for (const row of data || []) {
    try {
      map.set(row.key.slice(KEY.length), cleanPermissions(JSON.parse(row.value)))
    } catch {}
  }
  return map
}

/** Accesso di chi fa la richiesta, o null se non e' ne' admin ne' dipendente attivo. */
export async function getStaffAccess(req: NextRequest): Promise<StaffAccess | null> {
  const user = await userFromRequest(req)
  if (!user?.email) return null
  const email = user.email.toLowerCase()
  if (isAdminEmail(email)) return { userId: user.id, email, isAdmin: true, permissions: {} }

  const { data: member } = await supabaseAdmin
    .from('chat_members')
    .select('is_active')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!member?.is_active) return null
  return { userId: user.id, email, isAdmin: false, permissions: await getPermissions(user.id) }
}

export function canAccess(access: StaffAccess | null, page: StaffPage, cap = 'view') {
  return Boolean(access && (access.isAdmin || hasCap(access.permissions, page, cap)))
}

/**
 * Da usare all'inizio delle route: restituisce l'accesso oppure la risposta
 * di errore pronta (401 senza login, 403 senza il permesso richiesto).
 */
export async function guard(req: NextRequest, page: StaffPage, cap = 'view'): Promise<StaffAccess | NextResponse> {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (!canAccess(access, page, cap)) {
    return NextResponse.json({ error: 'Non hai il permesso per questa operazione: chiedilo all’amministratore.' }, { status: 403 })
  }
  return access
}
