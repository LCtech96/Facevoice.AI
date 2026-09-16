import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type ChatMember = {
  user_id: string
  email: string
  display_name: string | null
  role: 'admin' | 'employee'
  monthly_limit_usd: number
  is_active: boolean
}

export type UsageSummary = {
  spentUsd: number
  limitUsd: number
  remainingUsd: number
  periodStart: string
}

export class ChatAuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Inizio del mese corrente in UTC: e' il periodo su cui vale il tetto. */
export function currentPeriodStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

/**
 * Risolve l'utente dal token Supabase e verifica che sia un membro
 * abilitato. L'identita' viene SEMPRE dal token, mai dal body della
 * richiesta: e' il punto in cui un client non puo' mentire.
 */
export async function requireChatMember(req: NextRequest): Promise<ChatMember> {
  const token = bearerToken(req)
  if (!token) {
    throw new ChatAuthError('Autenticazione richiesta.', 401)
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    throw new ChatAuthError('Sessione non valida o scaduta.', 401)
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from('chat_members')
    .select('user_id, email, display_name, role, monthly_limit_usd, is_active')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (memberError) {
    throw new ChatAuthError('Errore nel verificare le autorizzazioni.', 500)
  }

  if (!member) {
    throw new ChatAuthError(
      'Questo account non e’ abilitato alla chat interna. Chiedi a un amministratore di aggiungerti.',
      403
    )
  }

  if (!member.is_active) {
    throw new ChatAuthError('Il tuo accesso alla chat interna e’ stato sospeso.', 403)
  }

  return member as ChatMember
}

export async function requireChatAdmin(req: NextRequest): Promise<ChatMember> {
  const member = await requireChatMember(req)
  if (member.role !== 'admin') {
    throw new ChatAuthError('Riservato agli amministratori.', 403)
  }
  return member
}

/** Spesa del mese corrente per un utente. */
export async function getUsageSummary(member: ChatMember): Promise<UsageSummary> {
  const periodStart = currentPeriodStart()

  const { data, error } = await supabaseAdmin
    .from('chat_usage')
    .select('cost_usd')
    .eq('user_id', member.user_id)
    .gte('created_at', periodStart.toISOString())

  if (error) {
    throw new ChatAuthError('Errore nel calcolare il consumo.', 500)
  }

  const spentUsd = (data || []).reduce(
    (total, row: { cost_usd: number | string }) => total + Number(row.cost_usd || 0),
    0
  )
  const limitUsd = Number(member.monthly_limit_usd)

  return {
    spentUsd,
    limitUsd,
    remainingUsd: Math.max(0, limitUsd - spentUsd),
    periodStart: periodStart.toISOString(),
  }
}

/**
 * Tetto rigido: se il mese e' gia' esaurito la richiesta non parte.
 *
 * Il controllo e' prima della chiamata, quindi l'ultimo messaggio puo'
 * sforare di poco il limite (non si conosce il costo finche' la
 * risposta non e' arrivata). E' voluto: l'alternativa sarebbe
 * interrompere una risposta a meta'.
 */
export async function assertWithinLimit(member: ChatMember): Promise<UsageSummary> {
  const usage = await getUsageSummary(member)

  if (usage.spentUsd >= usage.limitUsd) {
    throw new ChatAuthError(
      `Limite mensile raggiunto ($${usage.limitUsd.toFixed(2)}). ` +
        'Il contatore riparte il primo del mese; per alzare il tetto chiedi a un amministratore.',
      402
    )
  }

  return usage
}

export async function recordUsage(params: {
  userId: string
  chatId: string | null
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  costUsd: number
}): Promise<void> {
  const { error } = await supabaseAdmin.from('chat_usage').insert({
    user_id: params.userId,
    chat_id: params.chatId,
    model: params.model,
    input_tokens: params.usage.input_tokens,
    output_tokens: params.usage.output_tokens,
    cache_creation_input_tokens: params.usage.cache_creation_input_tokens,
    cache_read_input_tokens: params.usage.cache_read_input_tokens,
    cost_usd: params.costUsd,
  })

  // Un errore qui non deve far fallire una risposta gia' pagata e
  // consegnata, ma va reso visibile nei log: e' un buco nel contatore.
  if (error) {
    console.error('chat_usage insert failed:', error.message)
  }
}
