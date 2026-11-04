import { callAI, hasAIProvider } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { listConnections } from './connections'
import { canPublish } from './publish'
import { workspaceName } from './responder'
import {
  cancelPost,
  carouselOutline,
  createPost,
  editCarousel,
  editSlidePhoto,
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
  arrangeModes,
  type ArrangeMode,
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

export type PostView = Pick<PostRow, 'id' | 'status' | 'kind' | 'title' | 'caption' | 'facebook_text' | 'media' | 'platforms' | 'publish_at' | 'results' | 'error_message'> & {
  /** Slide spostabili o da togliere nell'anteprima (vedi ArrangeMode). */
  arrange?: ArrangeMode
}

/** Aggiunge ai post se le slide si possono spostare o togliere. */
export async function withArrange<T extends PostView>(posts: T[]): Promise<T[]> {
  if (!posts.length) return posts
  const modes = await arrangeModes(posts).catch(() => new Map<string, ArrangeMode>())
  return posts.map((p) => ({ ...p, arrange: modes.get(p.id) ?? null }))
}

export type ChatTurn = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
  /** Cosa mostra ogni foto allegata (stesso ordine), letto dall'AI. */
  imageNotes?: (string | null)[]
  /** Slide scelta dal cliente toccandola nell'anteprima (la richiesta riguarda quella). */
  target?: { postId: string; slide: number; thumb?: string }
  actions?: ChatAction[]
  at: string
}

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
  const byId = new Map((await withArrange((data || []) as PostView[])).map((p) => [p.id, p]))
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
- "create_post": {"brief": "tutto quello che ha chiesto, con le sue parole", "images": ["url", ...] opzionale, "kind": "photos|carousel", "slides": [{"title": "", "text": ""}, ...] opzionale, "hook": "opzionale", "label": "opzionale", "closing": false, "ai_images": true} → crea un post IN BOZZA e lo mostra con l'anteprima (didascalia modificabile, giorno e ora, Programma e Pubblica ora).
  · "photos" = le sue foto così come sono, senza scritte.
  · "carousel" CON foto = UNA SLIDE PER FOTO, nell'ordine esatto delle foto (Foto 1 = slide 1 = copertina con il gancio in grande; Foto 2 = slide 2…), testo SOPRA la foto e il logo su ogni slide. Nessuna foto viene aggiunta o tolta. In "slides" metti un elemento per ogni foto, nello stesso ordine: per la Foto k scrivi titolo e testo della slide k seguendo ALLA LETTERA quello che il cliente ha chiesto per quella foto (slides[0].title = riga piccola sotto il gancio della copertina). "closing": true solo se chiede una slide finale in più.
  · "carousel" SENZA foto = slide grafiche con testi grandi, colori del marchio e immagini create dall'AI (ai_images false per evitarle).
  Se non passi "images" usa le foto allegate al messaggio, nel loro ordine. Ci vuole fino a un paio di minuti.
- "edit_carousel": {"post_id": "…", "slides": [{"n": 3, "title": "…", "text": "…"}], "order": [2,1,3,…], "remove": [5], "hook": "…", "label": "…", "closing": true|false} → corregge un carosello con le foto e lo rifà: testi di singole slide (n = numero della slide, la copertina è 1), nuovo ordine delle foto (tutti i numeri, una volta ciascuno), slide da togliere, gancio. Usalo per "nella terza scrivi…", "scambia la 2 e la 4", "togli l'ultima".
- "post_outline": {"post_id": "…"} → testi attuali di ogni slide di un carosello con le foto (prima di correggerlo).
- "edit_slide_photo": {"post_id": "…", "n": 3, "instruction": "cosa cambiare nell'immagine"} → modifica con l'AI SOLO l'immagine della slide n (luce, colori, sfondo, togliere o aggiungere qualcosa) e rifà il post; nei caroselli con le foto il testo della slide resta com'è.
Se nella richiesta c'è "[Slide selezionata dal cliente…]", il cliente ha toccato quella slide nell'anteprima e la richiesta riguarda SOLO quella: se chiede di cambiare scritte, titolo o testo usa edit_carousel su quel numero; se chiede di cambiare la foto o l'immagine usa edit_slide_photo; se chiede entrambe le cose, fai tutte e due. Non toccare le altre slide.
- "edit_image": {"image": "url", "instruction": "cosa cambiare"} → modifica una foto con l'AI (luce, sfondo, colori, togliere oggetti, aggiungere una scritta…) e mostra il risultato. Per usarla in un post passala poi in "images" di create_post o update_post.
- "generate_image": {"description": "cosa deve mostrare"} → crea un'immagine da zero.
- "update_post": {"post_id": "…", "caption": "…", "facebook": "…", "platforms": ["instagram","facebook"], "images": ["url", ...]} → cambia testi, social o immagini di un post non ancora pubblicato.
- "schedule_post": {"post_id": "…", "when": "AAAA-MM-GGTHH:MM" (ora italiana), "platforms": opzionale} → programma la pubblicazione. Calcola tu la data da "giovedì alle 18", "domani mattina alle 9" ecc. partendo dall'ora italiana qui sopra. Se manca l'ora chiedila.
- "publish_now": {"post_id": "…"} → pubblica subito. Usalo SOLO se lo chiede esplicitamente ("pubblicalo ora", "pubblica adesso").
- "unschedule_post": {"post_id": "…"} → annulla la programmazione (il post torna in bozza).
- "list_posts": {"status": "draft|scheduled|published|failed|all"} → elenco dei post con stato, data e id.
- "show_post": {"post_id": "…"} → mostra di nuovo l'anteprima di un post.
- "set_brand": {"dark": "#rrggbb", "accent": "#rrggbb", "handle": "@nome o testo in fondo alle slide", "logo": "url di una foto allegata, oppure \"\" per toglierlo"} → colori, firma e LOGO dei caroselli (il logo va in alto su ogni slide). Se il cliente allega il suo logo e chiede di usarlo, passalo qui prima di create_post. Se chiede il logo ma non l'ha mai caricato, chiedigli di allegarlo.
- "messages_overview": {"hours": 24, "platform": "all|instagram|facebook|email|whatsapp", "kind": "all|message|comment"} → messaggi e commenti ricevuti nel periodo (chi, canale, testo, ora), per domande come "che proposte di collaborazione abbiamo ricevuto oggi?" o "chi ha chiesto i prezzi questa settimana?". Poi rispondi tu con un riassunto chiaro: nomi, cosa chiedono, cosa conviene fare.

Regole:
- Non dire mai "non posso" se c'è uno strumento adatto: usalo.
- Le foto allegate sono nelle righe "[Foto allegate…]", numerate nell'ordine in cui le ha caricate, con l'indirizzo e la descrizione di cosa mostrano: LE VEDI attraverso quelle descrizioni. Usale per abbinare i testi alle foto giuste. Le foto mandate prima nella conversazione sono in "[Foto mandate prima…]".
- Quando il cliente dice "la prima…", "la seconda…", rispetta quell'ordine: non riordinare, non saltare, non aggiungere foto. Se dice che l'ordine va cambiato in base al contenuto (es. "metti prima la piscina"), usa le descrizioni per trovare la foto e passa "images" nell'ordine nuovo.
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

/** Descrizione della slide toccata dal cliente: post, numero e testo attuale. */
async function targetNote(target: { postId: string; slide: number }) {
  const outline = await carouselOutline(target.postId).catch(() => null)
  const slide = outline?.slide.find((x) => x.n === target.slide)
  return `[Slide selezionata dal cliente: post_id ${target.postId}, slide ${target.slide}${slide ? ` — titolo attuale «${slide.titolo}», testo attuale «${slide.testo}»` : ''}${target.slide === 1 && outline ? ` — gancio attuale «${outline.gancio}»` : ''}]`
}

/** Una richiesta del cliente: passi con gli strumenti, poi la risposta (con anteprime). */
export async function runClientAssistant(
  db: WorkspaceDb,
  userId: string,
  message: string,
  images: string[],
  history: ChatTurn[],
  imageNotes: (string | null)[] = [],
  target?: { postId: string; slide: number } | null
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
  const earlierTurns = history.filter((t) => t.role === 'user' && t.images?.length).slice(-4)
  const earlier = earlierTurns.flatMap((t) => t.images || [])
  const earlierLines = earlierTurns.flatMap((t) => (t.images || []).map((url, k) => `- ${url}${t.imageNotes?.[k] ? ` — ${t.imageNotes[k]}` : ''}`))
  const request = [
    message || 'Guarda le foto allegate.',
    images.length
      ? `[Foto allegate a questo messaggio, nell'ordine in cui le ha caricate]\n${images.map((url, k) => `Foto ${k + 1}: ${url}\n   mostra: ${imageNotes[k] || '(descrizione non disponibile)'}`).join('\n')}`
      : '',
    earlierLines.length ? `[Foto mandate prima in questa conversazione]\n${earlierLines.join('\n')}` : '',
    target ? await targetNote(target) : '',
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
    const postId = asText(args.post_id) || target?.postId || lastPost()?.post.id || ''
    let result: unknown
    try {
      switch (call.tool) {
        case 'create_post': {
          const given = asUrls(args.images)
          const chosen = given.length ? given : images
          // Descrizioni gia' lette, nello stesso ordine delle foto scelte.
          const noteFor = (url: string) => {
            const k = images.indexOf(url)
            if (k >= 0) return imageNotes[k] ?? null
            for (const t of earlierTurns) {
              const j = (t.images || []).indexOf(url)
              if (j >= 0) return t.imageNotes?.[j] ?? null
            }
            return null
          }
          const post = await createPost(db, {
            brief: asText(args.brief) || message,
            images: chosen,
            kind: args.kind === 'carousel' ? 'carousel' : args.kind === 'photos' ? 'photos' : undefined,
            aiImages: args.ai_images !== false,
            userId,
            photoNotes: chosen.map(noteFor),
            slides: Array.isArray(args.slides)
              ? (args.slides as { title?: unknown; text?: unknown }[]).map((x) => ({ title: typeof x?.title === 'string' ? x.title : undefined, text: typeof x?.text === 'string' ? x.text : undefined }))
              : undefined,
            hook: asText(args.hook),
            label: asText(args.label),
            closing: args.closing === true,
          })
          showPost(post)
          result = { creato: true, post_id: post.id, tipo: post.kind, immagini: post.media.length, titolo: post.title, didascalia: post.caption.slice(0, 300), slide: (await carouselOutline(post.id))?.slide }
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
          const logoArg = typeof args.logo === 'string' ? (args.logo.trim() ? asUrls([args.logo])[0] || args.logo.trim() : '') : undefined
          const brand = await setWorkspaceBrand(db.workspaceId, { dark: asText(args.dark), accent: asText(args.accent), light: asText(args.light), handle: asText(args.handle), logo: logoArg })
          result = { salvato: true, firma: brand.handle, colori: brand.palette, logo: brand.logo ? 'impostato' : 'nessuno' }
          break
        }
        case 'edit_carousel': {
          const slides = Array.isArray(args.slides)
            ? (args.slides as { n?: unknown; title?: unknown; text?: unknown }[])
                .filter((x) => typeof x?.n === 'number')
                .map((x) => ({ n: x.n as number, title: typeof x.title === 'string' ? x.title : undefined, text: typeof x.text === 'string' ? x.text : undefined }))
            : undefined
          const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : undefined)
          const post = await editCarousel(db, postId, {
            slides,
            order: nums(args.order),
            remove: nums(args.remove),
            hook: asText(args.hook),
            label: asText(args.label),
            closing: typeof args.closing === 'boolean' ? args.closing : undefined,
          })
          showPost(post)
          result = { rifatto: true, post_id: post.id, slide: (await carouselOutline(post.id))?.slide }
          break
        }
        case 'edit_slide_photo': {
          const post = await editSlidePhoto(db, postId, Number(args.n) || target?.slide || 1, asText(args.instruction) || message)
          showPost(post)
          result = { rifatto: true, post_id: post.id, slide: Number(args.n) || target?.slide }
          break
        }
        case 'post_outline': {
          result = (await carouselOutline(postId)) || { errore: 'non è un carosello con le foto' }
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
