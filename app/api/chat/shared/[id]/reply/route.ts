import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMINI_DEFAULT_MODEL, callGeminiWithFallback, getGeminiApiKey, type GeminiAttachment } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructions } from '@/lib/current-datetime'
import { detectLanguage, type DetectedLanguage } from '@/lib/detect-language'
import { SITE_URL } from '@/lib/seo/site'

// Risposta AI nelle chat condivise (/ai-chat/shared/[id]). Chi riceve il link
// scrive senza account: si usa SOLO Gemini gratuito, con limiti per chat e per
// visitatore. Al limite la risposta invita a registrarsi, nella lingua di chi scrive.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HISTORY = 20
const CHAT_DAILY_LIMIT = 60
const IP_HOURLY_LIMIT = 25
const MAX_ATTACHMENT_CHARS = 6_000_000
const hits = new Map<string, number[]>()

function ipLimited(ip: string) {
  const now = Date.now()
  const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 60_000)
  list.push(now)
  hits.set(ip, list)
  return list.length > IP_HOURLY_LIMIT
}

const REGISTER_URL = `${SITE_URL}/auth`

const LIMIT_MESSAGES: Record<DetectedLanguage, string> = {
  it: `Hai raggiunto il limite di messaggi gratuiti con l'AI per ora. Se vuoi più crediti, registrati su Facevoice AI: ${REGISTER_URL}`,
  en: `You've reached the free AI message limit for now. If you'd like more credits, sign up on Facevoice AI: ${REGISTER_URL}`,
  fr: `Tu as atteint la limite de messages gratuits avec l'IA pour le moment. Pour plus de crédits, inscris-toi sur Facevoice AI : ${REGISTER_URL}`,
  es: `Has alcanzado el límite de mensajes gratuitos con la IA por ahora. Si quieres más créditos, regístrate en Facevoice AI: ${REGISTER_URL}`,
  de: `Du hast das Limit für kostenlose KI-Nachrichten vorerst erreicht. Für mehr Guthaben registriere dich bei Facevoice AI: ${REGISTER_URL}`,
  pt: `Atingiste o limite de mensagens gratuitas com a IA por agora. Se quiseres mais créditos, regista-te na Facevoice AI: ${REGISTER_URL}`,
  ru: `Вы достигли лимита бесплатных сообщений с ИИ. Чтобы получить больше кредитов, зарегистрируйтесь в Facevoice AI: ${REGISTER_URL}`,
  ar: `لقد وصلت إلى الحد الأقصى للرسائل المجانية مع الذكاء الاصطناعي حالياً. للحصول على رصيد إضافي، سجّل في Facevoice AI: ${REGISTER_URL}`,
  zh: `你已达到免费 AI 消息的上限。如需更多额度，请在 Facevoice AI 注册：${REGISTER_URL}`,
}

const ERROR_MESSAGES: Record<DetectedLanguage, string> = {
  it: 'Non sono riuscito a rispondere per un problema tecnico. Riprova tra poco.',
  en: 'I couldn’t reply because of a technical problem. Please try again shortly.',
  fr: 'Je n’ai pas pu répondre à cause d’un problème technique. Réessaie dans un instant.',
  es: 'No he podido responder por un problema técnico. Inténtalo de nuevo en un momento.',
  de: 'Ich konnte wegen eines technischen Problems nicht antworten. Versuche es gleich noch einmal.',
  pt: 'Não consegui responder por um problema técnico. Tenta de novo daqui a pouco.',
  ru: 'Не удалось ответить из-за технической проблемы. Попробуйте ещё раз чуть позже.',
  ar: 'تعذّر الرد بسبب مشكلة تقنية. حاول مرة أخرى بعد قليل.',
  zh: '由于技术问题未能回复，请稍后再试。',
}

const isLimitError = (message: string) => /rate limit|quota|prepayment|RESOURCE_EXHAUSTED|429/i.test(message)

async function saveAssistant(chatId: string, content: string) {
  const { data } = await supabaseAdmin
    .from('shared_chat_messages')
    .insert({ chat_id: chatId, role: 'assistant', content, user_id: null, user_name: 'AI' })
    .select('id, role, content, created_at')
    .single()
  return data
}

/** body: { attachments?: [{ mimeType, data }] } per l'ultimo messaggio dell'utente (le immagini non si salvano). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params
  const body = await req.json().catch(() => ({}))

  const { data: rows, error } = await supabaseAdmin
    .from('shared_chat_messages')
    .select('role, content, created_at')
    .eq('chat_id', chatId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(HISTORY)
  if (error) return NextResponse.json({ error: 'Chat non trovata' }, { status: 404 })
  const history = (rows || []).reverse()
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  if (!lastUser) return NextResponse.json({ error: 'Nessun messaggio' }, { status: 400 })
  const lang = detectLanguage(lastUser.content || '')

  // Limiti del gratuito: per chat al giorno e per visitatore all'ora.
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { count } = await supabaseAdmin
    .from('shared_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .eq('role', 'assistant')
    .gte('created_at', since)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if ((count || 0) >= CHAT_DAILY_LIMIT || ipLimited(ip) || !getGeminiApiKey()) {
    return NextResponse.json({ message: await saveAssistant(chatId, LIMIT_MESSAGES[lang]), limited: true })
  }

  const attachments: GeminiAttachment[] = (Array.isArray(body?.attachments) ? body.attachments : [])
    .filter((a: { mimeType?: unknown; data?: unknown }) => typeof a?.mimeType === 'string' && typeof a?.data === 'string')
    .filter((a: { mimeType: string; data: string }) => a.mimeType.startsWith('image/') && a.data.length < MAX_ATTACHMENT_CHARS)
    .slice(0, 4)

  const messages = history.map((m, i) => ({
    role: m.role,
    content: m.content,
    attachments: i === history.length - 1 && m.role === 'user' && attachments.length ? attachments : undefined,
  }))

  const system = `Sei l'assistente AI di Facevoice.AI in una chat condivisa fra più partecipanti.

${buildRealtimeDateTimeInstructions()}

Rispondi in modo breve e concreto, SEMPRE nella stessa lingua dell'ultimo messaggio di chi scrive. Quando qualcuno invia un'immagine, analizzala con attenzione.`

  try {
    const result = await callGeminiWithFallback(messages, GEMINI_DEFAULT_MODEL, system, { maxOutputTokens: 2048 })
    const text = (result.message || '').trim() || ERROR_MESSAGES[lang]
    return NextResponse.json({ message: await saveAssistant(chatId, text) })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    console.error('shared chat reply:', message)
    const reply = isLimitError(message) ? LIMIT_MESSAGES[lang] : ERROR_MESSAGES[lang]
    return NextResponse.json({ message: await saveAssistant(chatId, reply), limited: isLimitError(message) })
  }
}
