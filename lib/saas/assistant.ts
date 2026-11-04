import { callAI, hasAIProvider } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { listConnections } from './connections'
import { canPublish } from './publish'
import { workspaceName } from './responder'
import {
  cancelPost,
  createPost,
  editImage,
  generateImage,
  getPost,
  listPosts,
  publishPost,
  romeLabel,
  romeLocalToDate,
  schedulePost,
  setWorkspaceBrand,
  updatePost,
  type PostPlatform,
  type PostRow,
} from './posts'

// Assistente AI dell'area clienti: il cliente scrive (o detta) cosa vuole e
// allega foto; l'assistente crea i post, modifica le immagini, li programma o
// li pubblica, e risponde a domande sui messaggi e i commenti ricevuti.
// Conversazione salvata per persona e spazio (app_settings ws_chat:<spazio>:<utente>).

export type ChatAction =
  | { kind: 'post'; post: PostView }
  | { kind: 'image'; url: string; note: string }

export type PostView = Pick<PostRow, 'id' | 'status' | 'kind' | 'title' | 'caption' | 'facebook_text' | 'media' | 'platforms' | 'publish_at' | 'results' | 'error_message'>

export type ChatTurn = { role: 'user' | 'assistant'; text: string; images?: string[]; actions?: ChatAction[]; at: string }

const chatKey = (workspaceId: string, userId: string) => `ws_chat:${workspaceId}:${userId}`
const MAX_TURNS = 40
const MAX_STEPS = 6

export const postView = (p: PostRow): PostView => ({
  id: p.id,
  status: p.status,
  kind: p.kind,
  title: p.title,
  caption: p.caption,
  facebook_text: p.facebook_text,
  media: p.media,
  platforms: p.platforms,
  publish_at: p.publish_at,
  results: p.results,
  error_message: p.error_message,
})

export async function loadChat(workspaceId: string, userId: string): Promise<ChatTurn[]> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', chatKey(workspaceId, userId)).maybeSingle()
  try {
    const turns = data?.value ? (JSON.parse(data.value) as ChatTurn[]) : []
    return Array.isArray(turns) ? turns : []
  } catch {
    return []
  }
}

export async function saveChat(workspaceId: string, userId: string, turns: ChatTurn[]) {
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: chatKey(workspaceId, userId), value: JSON.stringify(turns.slice(-MAX_TURNS)), updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

/** Stato aggiornato dei post mostrati nella chat (programmati, pubblicati…). */
export async function refreshPostActions(db: WorkspaceDb, turns: ChatTurn[]): Promise<ChatTurn[]> {
  const ids = [...new Set(turns.flatMap((t) => (t.actions || []).filter((a) => a.kind === 'post').map((a) => (a as { post: PostView }).post.id)))]
  if (!ids.length) return turns
  const { data } = await db.from('workspace_posts').select('id, status, kind, title, caption, facebook_text, media, platforms, publish_at, results, error_message').in('id', ids)
  const byId = new Map((data || []).map((p) => [p.id as string, p as PostView]))
  return turns.map((t) => ({
    ...t,
    actions: t.actions?.map((a) => (a.kind === 'post' && byId.has(a.post.id) ? { ...a, post: byId.get(a.post.id)! } : a)),
  }))
}

const PROMPT = (name: string, now: string, channels: string, recent: string) => `Sei l'assistente AI di "${name}" nella piattaforma Facevoice AI. Il titolare (o un collaboratore) ti scrive in linguaggio naturale, anche a voce, e allega foto. Tu fai le cose usando gli strumenti, anche in più passaggi, senza chiedere conferme inutili. Rispondi nella lingua di chi ti scrive, in modo breve e chiaro, senza markdown.

Ora italiana: ${now}
Account collegati: ${channels}
Post recenti: ${recent}

A ogni passo rispondi SOLO con un JSON, in uno di questi due formati:
{"tool": "nome", "args": {...}}
{"reply": "risposta finale"}

Strumenti:
- "create_post": {"brief": "tutto quello che ha chiesto: argomento, offerta, tono, a chi si rivolge, dettagli", "images": ["url", ...] opzionale, "kind": "photos|carousel", "ai_images": true} → crea un post IN BOZZA e lo mostra con l'anteprima (didascalia modificabile, scelta di giorno e ora, pulsanti Programma e Pubblica ora). "photos" = le sue foto così come sono (consigliato quando allega foto, salvo che chieda grafiche o un carosello con scritte); "carousel" = slide grafiche con testi grandi e i colori del marchio, con le sue foto dentro e, dove mancano, immagini create dall'AI (ai_images false per evitarle). Se non passi "images" usa le foto allegate al messaggio. Ci vuole fino a un paio di minuti.
- "edit_image": {"image": "url", "instruction": "cosa cambiare"} → modifica una foto con l'AI (luce, sfondo, colori, togliere oggetti, aggiungere una scritta…) e mostra il risultato. Per usarla in un post passala poi in "images" di create_post o update_post.
- "generate_image": {"description": "cosa deve mostrare"} → crea un'immagine da zero.
- "update_post": {"post_id": "…", "caption": "…", "facebook": "…", "platforms": ["instagram","facebook"], "images": ["url", ...]} → cambia testi, social o immagini di un post non ancora pubblicato.
- "schedule_post": {"post_id": "…", "when": "AAAA-MM-GGTHH:MM" (ora italiana), "platforms": opzionale} → programma la pubblicazione. Calcola tu la data da "giovedì alle 18", "domani mattina alle 9" ecc. partendo dall'ora italiana qui sopra. Se manca l'ora chiedila.
- "publish_now": {"post_id": "…"} → pubblica subito. Usalo SOLO se lo chiede esplicitamente ("pubblicalo ora", "pubblica adesso").
- "unschedule_post": {"post_id": "…"} → annulla la programmazione (il post torna in bozza).
- "list_posts": {"status": "draft|scheduled|published|failed|all"} → elenco dei post con stato, data e id.
- "show_post": {"post_id": "…"} → mostra di nuovo l'anteprima di un post.
- "set_brand": {"dark": "#rrggbb", "accent": "#rrggbb", "handle": "@nome o testo in fondo alle slide"} → colori e firma dei caroselli grafici.
- "messages_overview": {"hours": 24, "platform": "all|instagram|facebook|email|whatsapp", "kind": "all|message|comment"} → messaggi e commenti ricevuti nel periodo (chi, canale, testo, ora), per domande come "che proposte di collaborazione abbiamo ricevuto oggi?" o "chi ha chiesto i prezzi questa settimana?". Poi rispondi tu con un riassunto chiaro: nomi, cosa chiedono, cosa conviene fare.

Regole:
- Non dire mai "non posso" se c'è uno strumento adatto: usalo.
- Le foto allegate sono nelle righe "[Foto allegate…]" come indirizzi: usa quelli, nell'ordine. Le foto mandate prima nella conversazione sono in "[Foto mandate prima…]".
- Dopo create_post o edit_image l'anteprima compare da sola sotto la tua risposta: non ripetere l'indirizzo, di' in breve cosa hai fatto e cosa può fare (modificare il testo, programmare, pubblicare).
- Non pubblicare né programmare se non lo ha chiesto. Se chiede di programmare un post appena creato, fai create_post e poi schedule_post nella stessa richiesta.
- Non inventare prezzi, date, promozioni o dati che non ti ha dato.`

const asText = (v: unknown) => (typeof v === 'string' ? v : undefined)
const asUrls = (v: unknown) => (Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')) : [])
const asPlatforms = (v: unknown) => (Array.isArray(v) ? (v.filter((p) => p === 'instagram' || p === 'facebook') as PostPlatform[]) : undefined)

function parseStep(raw: string): { tool?: string; args?: Record<string, unknown>; reply?: string } | null {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0]
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

async function messagesOverview(db: WorkspaceDb, args: Record<string, unknown>) {
  const hours = Math.min(24 * 31, Math.max(1, Number(args.hours) || 24))
  let query = db
    .from('social_messages')
    .select('platform, kind, contact_name, contact_id, body, subject, created_at')
    .eq('direction', 'in')
    .gte('created_at', new Date(Date.now() - hours * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(80)
  const platform = asText(args.platform)
  if (platform && platform !== 'all') query = query.eq('platform', platform)
  const kind = asText(args.kind)
  if (kind === 'message' || kind === 'comment') query = query.eq('kind', kind)
  const { data } = await query
  return {
    periodo_ore: hours,
    totale: data?.length || 0,
    ricevuti: (data || []).map((m) => ({
      canale: m.platform,
      tipo: m.kind === 'comment' ? 'commento' : 'messaggio',
      chi: m.contact_name || m.contact_id,
      oggetto: m.subject || undefined,
      testo: String(m.body || '').slice(0, 400),
      quando: new Date(m.created_at as string).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    })),
  }
}

/** Una richiesta del cliente: passi con gli strumenti, poi la risposta (con anteprime). */
export async function runClientAssistant(
  db: WorkspaceDb,
  userId: string,
  message: string,
  images: string[],
  history: ChatTurn[]
): Promise<{ reply: string; actions: ChatAction[] }> {
  if (!hasAIProvider()) return { reply: 'L’assistente non è disponibile in questo momento.', actions: [] }
  const [name, connections, recent] = await Promise.all([workspaceName(db.workspaceId), listConnections(db).catch(() => []), listPosts(db, { limit: 8 }).catch(() => [])])
  const active = connections.filter((c) => c.status === 'connected')
  const channels =
    active
      .map((c) => `${c.platform} ${c.display_name || c.external_id}${c.platform === 'instagram' && !canPublish(c) ? ' (pubblicazione non ancora consentita: va ricollegato)' : ''}`)
      .join(', ') || 'nessuno'
  const recentText = recent.length
    ? recent
        .filter((p) => p.status !== 'cancelled')
        .map((p) => `${p.id} · ${p.title || 'post'} · ${p.status}${p.publish_at ? ` · ${romeLabel(p.publish_at)}` : ''}`)
        .join('\n')
    : 'nessuno'
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const earlier = history.filter((t) => t.role === 'user').slice(-6).flatMap((t) => t.images || [])
  const request = [
    message || 'Guarda le foto allegate.',
    images.length ? `[Foto allegate a questo messaggio, in ordine]\n${images.join('\n')}` : '',
    earlier.length ? `[Foto mandate prima in questa conversazione]\n${earlier.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const past = history.slice(-8).map((t) => `${t.role === 'user' ? 'Cliente' : 'Assistente'}: ${t.text.slice(0, 600)}`).join('\n')
  const transcript: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: `${past ? `Conversazione recente:\n${past}\n\n` : ''}Richiesta: ${request}` }]
  const system = PROMPT(name, now, channels, recentText)
  const actions: ChatAction[] = []
  const lastPost = () => [...actions].reverse().find((a) => a.kind === 'post') as { post: PostView } | undefined
  const showPost = (post: PostRow) => {
    const existing = actions.findIndex((a) => a.kind === 'post' && a.post.id === post.id)
    const action: ChatAction = { kind: 'post', post: postView(post) }
    if (existing >= 0) actions[existing] = action
    else actions.push(action)
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await callAI(transcript, system, { feature: 'saas_assistente', temperature: 0.3, maxOutputTokens: 1500, workspaceId: db.workspaceId })
    const raw = response.message || ''
    const call = parseStep(raw)
    if (!call) return { reply: raw.trim() || 'Non ho capito, puoi riformulare?', actions }
    if (call.reply !== undefined && !call.tool) return { reply: call.reply, actions }

    const args = call.args || {}
    const postId = asText(args.post_id) || lastPost()?.post.id || ''
    let result: unknown
    try {
      switch (call.tool) {
        case 'create_post': {
          const given = asUrls(args.images)
          const post = await createPost(db, {
            brief: asText(args.brief) || message,
            images: given.length ? given : images,
            kind: args.kind === 'carousel' ? 'carousel' : args.kind === 'photos' ? 'photos' : undefined,
            aiImages: args.ai_images !== false,
            userId,
          })
          showPost(post)
          result = { creato: true, post_id: post.id, tipo: post.kind, immagini: post.media.length, titolo: post.title, didascalia: post.caption.slice(0, 300) }
          break
        }
        case 'edit_image': {
          const url = asUrls([args.image])[0] || images[0] || earlier[earlier.length - 1]
          if (!url) {
            result = { errore: 'nessuna foto da modificare: chiedi di allegarla' }
            break
          }
          const edited = await editImage(db.workspaceId, url, asText(args.instruction) || message)
          actions.push({ kind: 'image', url: edited, note: asText(args.instruction) || 'Foto modificata' })
          result = { fatto: true, nuova_immagine: edited }
          break
        }
        case 'generate_image': {
          const created = await generateImage(db.workspaceId, asText(args.description) || message)
          actions.push({ kind: 'image', url: created, note: 'Immagine creata dall’AI' })
          result = { fatto: true, nuova_immagine: created }
          break
        }
        case 'update_post': {
          const media = asUrls(args.images)
          const post = await updatePost(db, postId, { caption: asText(args.caption), facebook: asText(args.facebook), platforms: asPlatforms(args.platforms), media: media.length ? media : undefined })
          showPost(post)
          result = { aggiornato: true, post_id: post.id }
          break
        }
        case 'schedule_post': {
          const when = romeLocalToDate(asText(args.when) || '')
          const post = await schedulePost(db, postId, when, asPlatforms(args.platforms))
          showPost(post)
          result = { programmato: true, quando: romeLabel(post.publish_at!), social: post.platforms }
          break
        }
        case 'publish_now': {
          const post = await publishPost(db, postId)
          showPost(post)
          result = { stato: post.status, instagram: post.results?.instagram ? 'pubblicato' : undefined, facebook: post.results?.facebook ? 'pubblicato' : undefined, errori: post.results?.errors }
          break
        }
        case 'unschedule_post': {
          const post = await cancelPost(db, postId)
          showPost(post)
          result = { annullato: true }
          break
        }
        case 'list_posts': {
          const status = asText(args.status)
          const list = await listPosts(db, { status: status && status !== 'all' ? [status as PostRow['status']] : undefined, limit: 20 })
          result = { post: list.filter((p) => p.status !== 'cancelled').map((p) => ({ post_id: p.id, titolo: p.title, stato: p.status, quando: p.publish_at ? romeLabel(p.publish_at) : null, social: p.platforms, errori: p.error_message })) }
          break
        }
        case 'show_post': {
          const post = await getPost(db, postId)
          if (!post) {
            result = { errore: 'post non trovato: usa list_posts' }
            break
          }
          showPost(post)
          result = { mostrato: true }
          break
        }
        case 'set_brand': {
          const brand = await setWorkspaceBrand(db.workspaceId, { dark: asText(args.dark), accent: asText(args.accent), light: asText(args.light), handle: asText(args.handle) })
          result = { salvato: true, firma: brand.handle, colori: brand.palette }
          break
        }
        case 'messages_overview':
          result = await messagesOverview(db, args)
          break
        default:
          result = { errore: `strumento sconosciuto: ${call.tool}` }
      }
    } catch (error) {
      result = { errore: error instanceof Error ? error.message : 'errore' }
    }
    transcript.push({ role: 'assistant', content: JSON.stringify({ tool: call.tool, args }) })
    transcript.push({ role: 'user', content: `Risultato di ${call.tool}: ${JSON.stringify(result).slice(0, 8000)}` })
  }
  return { reply: actions.length ? 'Ecco qui sotto.' : 'Non sono riuscito a finire: riprova con una richiesta più semplice.', actions }
}
