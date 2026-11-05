import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { linkConversations, memberKey, type Member } from '@/lib/meta/identities'
import { detectClaim, escapeLike, leadSince, normalizePhone, usableTarget, verificationFacts, type LeadRecord } from '@/lib/identity-verify'
import { cleanEmail } from '@/lib/email-address'
import { SOURCE_MANUAL } from '@/lib/contacts'
import { getMessageHeaders, senderAuthenticated } from '@/lib/gmail'

// Collegamento automatico "stessa persona" tra canali, SOLO con dati certi che non si
// possono inventare scrivendo in chat:
// - il numero WhatsApp (contact_id = numero vero, lo garantisce WhatsApp);
// - l'indirizzo email, se Gmail ha autenticato il mittente (DMARC/DKIM, nessun Reply-To
//   diverso) o se la conversazione ha solo nostri messaggi (indirizzo preso dalla scheda);
// - lo username Instagram dato da Meta (webhook o profilo), mai il nome visualizzato;
// - le schede Clienti con un contatto vero con noi (stessi criteri della verifica
//   dell'identita'), quando il dato corrisponde a UNA sola scheda;
// - la risposta privata a un commento (Meta indica lo stesso account) e la verifica con
//   il codice email (lib/identity-verify).
// Mai: nomi (uguali o simili), telefoni/email/profili scritti nei messaggi, prenotazioni
// (modulo pubblico: solo un suggerimento), pagamenti (un dato solo, non collega due canali),
// Facebook e chat del sito (nessun dato certo). Questi restano suggerimenti con "Collega".
//
// Stato in app_settings (nessuna tabella nuova):
//   identity_autolink:<platform>:<contactId> -> motivi dei collegamenti, suggerimenti,
//                                               username Instagram, mittente autenticato, ultimo controllo
//   identity_ig:<username>                   -> account Instagram visti con quello username
//   identity_unlinked                        -> coppie separate da Luca: mai ricollegate in automatico
//   identity_autolink_backfill               -> avanzamento del controllo delle conversazioni esistenti

const RECORD_PREFIX = 'identity_autolink:'
const IG_PREFIX = 'identity_ig:'
const SEPARATED_KEY = 'identity_unlinked'
const BACKFILL_KEY = 'identity_autolink_backfill'

const DAY_MS = 86_400_000
/** Ogni contatto si ricontrolla al massimo una volta al giorno (prima, se arriva un dato certo nuovo). */
const CHECK_EVERY_MS = DAY_MS
/** Come nella verifica: una scheda vale solo se esisteva gia' da almeno un giorno. */
const RECORD_MIN_AGE_MS = DAY_MS
/**
 * Uno username Instagram vale solo se visto di recente: dopo un cambio Instagram lo tiene
 * riservato 14 giorni, quindi entro 7 giorni non puo' essere passato a un'altra persona.
 */
const IG_FRESH_MS = 7 * DAY_MS
const HINT_TTL_MS = 14 * DAY_MS
const OWN_INSTAGRAM = new Set(['facevoice.ai'])
const AUTO_PLATFORMS = new Set(['whatsapp', 'email', 'instagram'])

export type AutoRule = 'lead' | 'ig_same_user' | 'private_reply' | 'verified'
/** Perche' due account sono stati collegati in automatico (salvato su entrambi). */
export type LinkNote = { rule: AutoRule; with: string; detail: string; at: string; leadId?: string }
/** Possibile stessa persona non collegata in automatico (dato non abbastanza certo o in conflitto). */
export type LinkHint = { with: string; detail: string; at: string; by: string; separated?: boolean }

type AutoRecord = {
  checkedAt?: string
  igUsername?: string
  igSeenAt?: string
  emailAuthAt?: string
  emailAuthCheckedAt?: string
  links?: LinkNote[]
  hints?: LinkHint[]
}

type LeadRow = LeadRecord & { id: string; instagram: string | null }
const LEAD_COLS = 'id, name, email, phone, instagram, status, contacted_at, created_at, search_query'

type Ctx = {
  now: number
  records: Map<string, AutoRecord>
  leads: Map<string, LeadRow[] | null>
  separations: Set<string> | null
  /** Controlli del mittente su Gmail ancora concessi in questo giro. */
  gmailChecks: number
}

const newCtx = (gmailChecks = 0): Ctx => ({ now: Date.now(), records: new Map(), leads: new Map(), separations: null, gmailChecks })
const nowIso = () => new Date().toISOString()

export function parseMemberKey(key: string): Member | null {
  const sep = key.indexOf(':')
  if (sep <= 0) return null
  return { platform: key.slice(0, sep), contactId: key.slice(sep + 1) }
}

function parseJson<T>(raw: string | null, fallback: T, valid: (v: unknown) => boolean): T {
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    return valid(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

const isObject = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const parseRecord = (raw: string | null): AutoRecord => parseJson<AutoRecord>(raw, {}, isObject)
const recordKey = (m: Member) => `${RECORD_PREFIX}${memberKey(m)}`

async function recordOf(ctx: Ctx, m: Member): Promise<AutoRecord> {
  const key = memberKey(m)
  const cached = ctx.records.get(key)
  if (cached) return cached
  const record = parseRecord((await readSetting(recordKey(m))).value)
  ctx.records.set(key, record)
  return record
}

async function editRecord(ctx: Ctx | null, m: Member, fn: (r: AutoRecord) => AutoRecord | false): Promise<AutoRecord> {
  const next = await updateSetting(recordKey(m), parseRecord, fn)
  ctx?.records.set(memberKey(m), next)
  return next
}

// ---------------------------------------------------------------------
// Coppie separate da Luca
// ---------------------------------------------------------------------

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const parseSeparations = (raw: string | null): Record<string, string> => parseJson<Record<string, string>>(raw, {}, isObject)

export async function loadSeparations(): Promise<Set<string>> {
  return new Set(Object.keys(parseSeparations((await readSetting(SEPARATED_KEY)).value)))
}

/** C'e' una coppia separata da Luca tra i due gruppi? (A–C piu' C–B non deve ricostruire A–B.) */
export function separatedBetween(separations: Set<string>, a: Member[], b: Member[]): boolean {
  if (!separations.size) return false
  return a.some((x) => b.some((y) => separations.has(pairKey(memberKey(x), memberKey(y)))))
}

/**
 * Luca ha separato un account dalla persona: nessuna di queste coppie viene piu' ricollegata
 * in automatico (anche passando da un altro account), e i motivi che non valgono piu' si tolgono.
 */
export async function recordSeparation(member: Member, formerGroup: Member[]) {
  const self = memberKey(member)
  const others = [...new Set(formerGroup.map(memberKey))].filter((k) => k !== self)
  if (!others.length) return
  const at = nowIso()
  await updateSetting(SEPARATED_KEY, parseSeparations, (map) => {
    const next = { ...map }
    for (const other of others) next[pairKey(self, other)] = at
    return next
  })
  await editRecord(null, member, (r) => {
    const hints = (r.hints || []).filter((h) => !others.includes(h.with))
    if (!(r.links || []).length && hints.length === (r.hints || []).length) return false
    return { ...r, links: [], hints }
  })
  for (const other of others) {
    const m = parseMemberKey(other)
    if (!m) continue
    await editRecord(null, m, (r) => {
      // Restano solo i motivi verso account ancora nello stesso gruppo.
      const links = (r.links || []).filter((n) => n.with !== self && others.includes(n.with))
      const hints = (r.hints || []).filter((h) => h.with !== self)
      if (links.length === (r.links || []).length && hints.length === (r.hints || []).length) return false
      return { ...r, links, hints }
    })
  }
}

/** Luca collega a mano due conversazioni: le separazioni tra i due gruppi non valgono piu'. */
export async function clearSeparations(a: Member[], b: Member[]) {
  const pairs = new Set<string>()
  for (const x of a) for (const y of b) pairs.add(pairKey(memberKey(x), memberKey(y)))
  if (!pairs.size) return
  await updateSetting(SEPARATED_KEY, parseSeparations, (map) => {
    const found = Object.keys(map).filter((k) => pairs.has(k))
    if (!found.length) return false
    const next = { ...map }
    for (const k of found) delete next[k]
    return next
  })
}

// ---------------------------------------------------------------------
// Dati certi: schede Clienti, conversazioni, Instagram, mittente email
// ---------------------------------------------------------------------

const IG_RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'direct', 'about', 'developer', 'legal'])

/** Username Instagram da un link, "@nome" o "nome" (come lo salvano le schede). */
export function instagramHandle(raw: string | null | undefined): string | null {
  let text = String(raw || '').trim().toLowerCase()
  if (!text) return null
  const url = text.match(/instagram\.com\/+([^/?#\s]+)/)
  if (url) text = url[1]
  else if (/[\s/]/.test(text)) return null
  text = text.replace(/^@/, '')
  if (!/^[a-z0-9._]{1,30}$/.test(text) || IG_RESERVED.has(text)) return null
  return text
}

/** Schede con quel dato (confronto esatto). null: troppe per dirlo (dato condiviso, es. centralino). */
async function leadsMatching(ctx: Ctx, kind: 'phone' | 'email' | 'instagram', value: string): Promise<LeadRow[] | null> {
  const key = `${kind}:${value}`
  if (ctx.leads.has(key)) return ctx.leads.get(key) ?? null
  let rows: LeadRow[] | null
  if (kind === 'phone') {
    // Filtro sul server con le ultime 4 cifre (qualsiasi separatore), poi il numero intero: mai solo le ultime cifre.
    const { data, error } = await supabaseAdmin.from('leads').select(LEAD_COLS).ilike('phone', `%${value.slice(-4).split('').join('%')}`).limit(500)
    if (error) throw new Error(error.message)
    const list = (data || []) as LeadRow[]
    rows = list.length >= 500 ? null : list.filter((l) => l.phone && normalizePhone(l.phone) === value)
  } else if (kind === 'email') {
    const { data, error } = await supabaseAdmin.from('leads').select(LEAD_COLS).ilike('email', escapeLike(value)).limit(20)
    if (error) throw new Error(error.message)
    rows = ((data || []) as LeadRow[]).filter((l) => cleanEmail(l.email) === value)
  } else {
    const { data, error } = await supabaseAdmin.from('leads').select(LEAD_COLS).ilike('instagram', `%${escapeLike(value)}%`).limit(100)
    if (error) throw new Error(error.message)
    const list = (data || []) as LeadRow[]
    rows = list.length >= 100 ? null : list.filter((l) => instagramHandle(l.instagram) === value)
  }
  ctx.leads.set(key, rows)
  return rows
}

/** Schede legate a un account dai suoi dati certi (numero, indirizzo, username Instagram). */
async function leadsOfMember(ctx: Ctx, m: Member): Promise<LeadRow[] | null> {
  if (m.platform === 'whatsapp') {
    const phone = normalizePhone(`+${m.contactId}`)
    return phone ? leadsMatching(ctx, 'phone', phone) : []
  }
  if (m.platform === 'email') {
    const email = cleanEmail(m.contactId)
    return email && usableTarget(email) ? leadsMatching(ctx, 'email', email) : []
  }
  if (m.platform === 'instagram') {
    const username = (await recordOf(ctx, m)).igUsername
    return username && !OWN_INSTAGRAM.has(username) ? leadsMatching(ctx, 'instagram', username) : []
  }
  return []
}

async function leadTies(ctx: Ctx, group: Member[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const m of group) for (const lead of (await leadsOfMember(ctx, m)) || []) ids.add(lead.id)
  return ids
}

/** 'in': la persona ci ha scritto; 'out': ci sono solo nostri messaggi; null: nessuna conversazione. */
async function conversationState(m: Member): Promise<'in' | 'out' | null> {
  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .select('direction')
    .eq('platform', m.platform)
    .eq('contact_id', m.contactId)
    .order('direction', { ascending: true })
    .limit(1)
  if (error) throw new Error(error.message)
  const direction = data?.[0]?.direction
  return direction === 'in' || direction === 'out' ? direction : null
}

/** Gruppo attuale dell'account (errore = nessun collegamento, mai un gruppo a meta'). */
async function groupOf(m: Member): Promise<{ members: Member[]; personId: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('social_identities')
    .select('person_id')
    .eq('platform', m.platform)
    .eq('contact_id', m.contactId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.person_id) return { members: [m], personId: null }
  const { data: rows, error: rowsError } = await supabaseAdmin.from('social_identities').select('platform, contact_id').eq('person_id', data.person_id)
  if (rowsError) throw new Error(rowsError.message)
  const members = (rows || []).map((r) => ({ platform: r.platform as string, contactId: r.contact_id as string }))
  return { members: members.length ? members : [m], personId: data.person_id as string }
}

/** Ultima email ricevuta da quell'indirizzo: il mittente era autenticato da Gmail? null se non si sa. */
async function gmailSenderCheck(address: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .select('external_id')
    .eq('platform', 'email')
    .eq('contact_id', address)
    .eq('direction', 'in')
    .like('external_id', 'gmail:%')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return null
  const id = String(data?.[0]?.external_id || '').slice('gmail:'.length)
  if (!id) return false
  try {
    return senderAuthenticated(await getMessageHeaders(id), address)
  } catch (error) {
    console.warn('collegamento automatico, controllo mittente:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Un indirizzo email vale come dato certo se Gmail ha autenticato chi scrive da li', oppure se
 * la conversazione ha solo nostri messaggi (l'indirizzo l'abbiamo preso noi dalla scheda).
 */
async function emailTrusted(ctx: Ctx, m: Member, state: 'in' | 'out'): Promise<boolean> {
  if (state === 'out') return true
  const record = await recordOf(ctx, m)
  if (record.emailAuthAt) return true
  if (record.emailAuthCheckedAt || ctx.gmailChecks <= 0) return false
  ctx.gmailChecks--
  const ok = await gmailSenderCheck(m.contactId)
  if (ok === null) return false
  const at = nowIso()
  await editRecord(ctx, m, (r) => ({ ...r, emailAuthCheckedAt: at, ...(ok && !r.emailAuthAt ? { emailAuthAt: at } : {}) }))
  return ok
}

type IgEntry = { id: string; at: string }
const parseIgIndex = (raw: string | null): IgEntry[] =>
  parseJson<IgEntry[]>(raw, [], (v) => Array.isArray(v)).filter((e) => e && typeof e.id === 'string' && typeof e.at === 'string')

/** Account Instagram visti di recente con questo username (dato da Meta). */
async function freshInstagramIds(ctx: Ctx, username: string): Promise<string[]> {
  const list = parseIgIndex((await readSetting(`${IG_PREFIX}${username}`)).value)
  return list.filter((e) => ctx.now - Date.parse(e.at) < IG_FRESH_MS).map((e) => e.id)
}

/** Salva lo username dato da Meta per questo account. true se e' nuovo o cambiato. */
async function rememberInstagramUsername(ctx: Ctx, m: Member, username: string): Promise<boolean> {
  const record = await recordOf(ctx, m)
  const seenToday = record.igSeenAt && ctx.now - Date.parse(record.igSeenAt) < DAY_MS
  if (record.igUsername === username && seenToday) return false
  const previous = record.igUsername
  const at = nowIso()
  await editRecord(ctx, m, (r) => ({ ...r, igUsername: username, igSeenAt: at }))
  if (previous && previous !== username) {
    await updateSetting(`${IG_PREFIX}${previous}`, parseIgIndex, (list) => {
      const next = list.filter((e) => e.id !== m.contactId)
      return next.length === list.length ? false : next
    })
  }
  await updateSetting(`${IG_PREFIX}${username}`, parseIgIndex, (list) => [...list.filter((e) => e.id !== m.contactId), { id: m.contactId, at }].slice(-10))
  return previous !== username
}

// ---------------------------------------------------------------------
// Collegamento (unico punto: regole automatiche, verifica, risposta privata)
// ---------------------------------------------------------------------

export type AutoLinkResult = {
  linked: boolean
  key?: string
  blocked?: 'same' | 'separated' | 'missing' | 'conflict' | 'verifying'
  why?: string
}

/** Due gruppi da non unire mai da soli: due numeri WhatsApp, verifiche con email diverse, schede diverse. */
async function conflictBetween(ctx: Ctx, a: Member[], b: Member[], verifiedA: string[], verifiedB: string[]): Promise<string | null> {
  const numbers = new Set([...a, ...b].filter((m) => m.platform === 'whatsapp').map((m) => m.contactId))
  if (numbers.size > 1) return 'due numeri WhatsApp diversi'
  if (new Set([...verifiedA, ...verifiedB]).size > 1) return 'verificate con email diverse'
  const [tiesA, tiesB] = await Promise.all([leadTies(ctx, a), leadTies(ctx, b)])
  if (tiesA.size && tiesB.size && ![...tiesA].some((id) => tiesB.has(id))) return 'dati di schede Clienti diverse'
  return null
}

/** Suggerimento "Collega" con il motivo, su entrambi gli account (mai per una coppia separata da Luca, salvo separated). */
async function writeHint(ctx: Ctx, a: Member, b: Member, detail: string, separated = false): Promise<boolean> {
  const [ga, gb] = await Promise.all([groupOf(a), groupOf(b)])
  if (ga.members.some((x) => gb.members.some((y) => memberKey(x) === memberKey(y)))) return false
  ctx.separations ??= await loadSeparations()
  if (!separated && separatedBetween(ctx.separations, ga.members, gb.members)) return false
  const at = nowIso()
  const by = memberKey(a)
  const put = (m: Member, withKey: string) =>
    editRecord(ctx, m, (r) => {
      const hints = (r.hints || []).filter((h) => h.with !== withKey && ctx.now - Date.parse(h.at) < HINT_TTL_MS)
      return { ...r, hints: [...hints, { with: withKey, detail, at, by, ...(separated ? { separated: true } : {}) }].slice(-5) }
    })
  await put(a, memberKey(b))
  await put(b, memberKey(a))
  return true
}

/**
 * Collega due account in automatico con il motivo visibile in Messaggi. Non collega se Luca
 * aveva separato una coppia tra i due gruppi, se i gruppi hanno dati in conflitto (in quel
 * caso lascia un suggerimento) o, per le regole basate sulle schede, se c'e' una verifica
 * dell'identita' non conclusa. Senza allowPhantom entrambi devono avere gia' dei messaggi.
 */
export async function autoLink(
  a: Member,
  b: Member,
  note: { rule: AutoRule; detail: string; leadId?: string },
  options: { allowPhantom?: boolean; leadBased?: boolean; ctx?: Ctx } = {}
): Promise<AutoLinkResult> {
  const ctx = options.ctx || newCtx()
  const ak = memberKey(a)
  const bk = memberKey(b)
  if (ak === bk) return { linked: false, blocked: 'same' }
  const [ga, gb] = await Promise.all([groupOf(a), groupOf(b)])
  if (ga.members.some((x) => gb.members.some((y) => memberKey(x) === memberKey(y)))) return { linked: false, blocked: 'same' }

  ctx.separations ??= await loadSeparations()
  if (separatedBetween(ctx.separations, ga.members, gb.members)) {
    // Verificata con il codice dopo una separazione: decide Luca, con un suggerimento.
    if (note.rule === 'verified') await writeHint(ctx, a, b, `${note.detail}, ma l’avevi separata: collega a mano se è la stessa persona`, true)
    return { linked: false, blocked: 'separated' }
  }

  if (!options.allowPhantom) {
    const [sa, sb] = await Promise.all([conversationState(a), conversationState(b)])
    if (!sa || !sb) return { linked: false, blocked: 'missing' }
  }

  const [fa, fb] = await Promise.all([verificationFacts(ga.members), verificationFacts(gb.members)])
  if (options.leadBased && (fa.open || fb.open)) {
    // Decide la verifica (o Luca): il collegamento con le schede non scavalca una verifica aperta o non riuscita.
    await writeHint(ctx, a, b, `${note.detail} (non collegata in automatico: c’è una verifica dell’identità non conclusa o non riuscita)`)
    return { linked: false, blocked: 'verifying' }
  }
  const conflict = await conflictBetween(ctx, ga.members, gb.members, fa.verifiedEmails, fb.verifiedEmails)
  if (conflict) {
    await writeHint(ctx, a, b, `${note.detail} (non collegata in automatico: ${conflict})`)
    return { linked: false, blocked: 'conflict', why: conflict }
  }

  const keyA = ga.personId ? `person:${ga.personId}` : ak
  const keyB = gb.personId ? `person:${gb.personId}` : bk
  const result = await linkConversations(keyA, keyB)
  if (result.error) throw new Error(result.error)

  const at = nowIso()
  const put = (m: Member, withKey: string) =>
    editRecord(ctx, m, (r) => ({
      ...r,
      links: [
        ...(r.links || []).filter((n) => n.with !== withKey),
        { rule: note.rule, with: withKey, detail: note.detail, at, ...(note.leadId ? { leadId: note.leadId } : {}) },
      ].slice(-10),
      hints: (r.hints || []).filter((h) => h.with !== withKey),
    }))
  await put(a, bk)
  await put(b, ak)
  console.log(`collegamento automatico (${note.rule}): ${a.platform} + ${b.platform}`)
  return { linked: true, key: result.key }
}

// ---------------------------------------------------------------------
// Controllo di un contatto (a ogni messaggio in arrivo e nel controllo delle conversazioni esistenti)
// ---------------------------------------------------------------------

const CHANNEL_LABEL = (m: Member, username?: string | null) =>
  m.platform === 'whatsapp' ? 'numero WhatsApp' : m.platform === 'email' ? 'email' : `profilo Instagram${username ? ` @${username}` : ''}`

async function pairDetail(ctx: Ctx, a: Member, b: Member, leadName: string | null) {
  const label = async (m: Member) => CHANNEL_LABEL(m, m.platform === 'instagram' ? (await recordOf(ctx, m)).igUsername : null)
  const [la, lb] = await Promise.all([label(a), label(b)])
  return `${la} ${/^[aeiou]/i.test(lb) ? 'ed' : 'e'} ${lb} della stessa scheda «${(leadName || 'senza nome').replace(/[«»]/g, '').slice(0, 60)}»`
}

/** Altri canali della scheda: solo dati che corrispondono a questa sola scheda e conversazioni gia' esistenti. */
async function leadCandidates(ctx: Ctx, lead: LeadRow, self: Member): Promise<Member[]> {
  const out: Member[] = []
  if (self.platform !== 'whatsapp' && lead.phone) {
    const phone = normalizePhone(lead.phone)
    const same = phone ? await leadsMatching(ctx, 'phone', phone) : null
    if (phone && same?.length === 1) out.push({ platform: 'whatsapp', contactId: phone })
  }
  if (self.platform !== 'email') {
    const email = cleanEmail(lead.email)
    const same = email && usableTarget(email) ? await leadsMatching(ctx, 'email', email) : null
    if (email && same?.length === 1) out.push({ platform: 'email', contactId: email })
  }
  if (self.platform !== 'instagram') {
    const handle = instagramHandle(lead.instagram)
    const same = handle && !OWN_INSTAGRAM.has(handle) ? await leadsMatching(ctx, 'instagram', handle) : null
    if (handle && same?.length === 1) for (const id of await freshInstagramIds(ctx, handle)) out.push({ platform: 'instagram', contactId: id })
  }
  return out
}

type Tally = { linked: number; hinted: number; hintedWith: Set<string>; handled: Set<string> }

/** Regole sulle schede Clienti: stesso numero, stessa email, stesso profilo Instagram di UNA scheda. */
async function leadRules(ctx: Ctx, self: Member, tally: Tally) {
  const leads = await leadsOfMember(ctx, self)
  // Nessuna scheda, o piu' schede con lo stesso dato (centralino, agenzia): niente collegamento.
  if (!leads || leads.length !== 1) return
  const lead = leads[0]
  const selfState = await conversationState(self)
  if (!selfState) return
  const cutoff = new Date(ctx.now - RECORD_MIN_AGE_MS).toISOString()
  // Stessi criteri della verifica: contattata, ha risposto, cliente o inserita a mano, da almeno un giorno.
  const trusted = Boolean(leadSince(lead, cutoff))
  const manual = lead.search_query === SOURCE_MANUAL

  for (const other of await leadCandidates(ctx, lead, self)) {
    const state = await conversationState(other)
    if (!state) continue
    tally.handled.add(memberKey(other))
    const detail = await pairDetail(ctx, self, other, lead.name)
    const instagram = self.platform === 'instagram' || other.platform === 'instagram'
    let why: string | null = null
    if (!trusted) why = 'la scheda non ha ancora un contatto con noi'
    // Il primo link Instagram letto dal sito e' spesso dell'agenzia o di un fornitore: vale solo se inserito a mano.
    else if (instagram && !manual) why = 'il profilo Instagram della scheda non è stato inserito a mano'
    else if (self.platform === 'email' && !(await emailTrusted(ctx, self, selfState))) why = 'mittente email non autenticato'
    else if (other.platform === 'email' && !(await emailTrusted(ctx, other, state))) why = 'mittente email non autenticato'
    if (why) {
      if (await writeHint(ctx, self, other, `${detail} (non collegata in automatico: ${why})`)) {
        tally.hinted++
        tally.hintedWith.add(memberKey(other))
      }
      continue
    }
    const result = await autoLink(self, other, { rule: 'lead', detail, leadId: lead.id }, { leadBased: true, ctx })
    if (result.linked) tally.linked++
    else if (result.blocked === 'conflict' || result.blocked === 'verifying') {
      tally.hinted++
      tally.hintedWith.add(memberKey(other))
    }
  }
}

/** Prenotazioni: il modulo e' pubblico (email e numero li scrive chiunque), quindi solo un suggerimento. */
async function bookingHints(ctx: Ctx, self: Member, tally: Tally) {
  const others: Member[] = []
  if (self.platform === 'whatsapp') {
    const phone = normalizePhone(`+${self.contactId}`)
    if (!phone) return
    const { data, error } = await supabaseAdmin.from('bookings').select('email, whatsapp').ilike('whatsapp', `%${phone.slice(-4).split('').join('%')}`).limit(50)
    if (error) return
    for (const b of data || []) {
      const email = cleanEmail(b.email)
      if (email && usableTarget(email) && b.whatsapp && normalizePhone(b.whatsapp) === phone) others.push({ platform: 'email', contactId: email })
    }
  } else if (self.platform === 'email') {
    const { data, error } = await supabaseAdmin.from('bookings').select('email, whatsapp').ilike('email', escapeLike(self.contactId)).limit(20)
    if (error) return
    for (const b of data || []) {
      const phone = b.whatsapp ? normalizePhone(b.whatsapp) : null
      if (phone && cleanEmail(b.email) === self.contactId) others.push({ platform: 'whatsapp', contactId: phone })
    }
  }
  const seen = new Set<string>()
  for (const other of others) {
    const key = memberKey(other)
    if (seen.has(key) || tally.handled.has(key) || seen.size >= 2) continue
    seen.add(key)
    if (!(await conversationState(other))) continue
    if (await writeHint(ctx, self, other, 'stessi numero ed email di una prenotazione (il modulo è pubblico: non è una prova)')) {
      tally.hinted++
      tally.hintedWith.add(key)
    }
  }
}

export type AutoLinkInput = {
  platform: string
  contactId: string
  kind?: 'message' | 'comment'
  /** Testo del messaggio: serve SOLO a capire se dice di conoscerci (allora decide la verifica). Mai come dato. */
  text?: string | null
  /** Username dato da Meta (webhook o profilo), mai il nome visualizzato. */
  instagramUsername?: string | null
  /** Mittente autenticato da Gmail (vedi senderAuthenticated). */
  emailAuthenticated?: boolean
  /** Ricontrolla anche se controllato da meno di un giorno. */
  force?: boolean
  /** Controlli del mittente su Gmail concessi (email ricevute prima di questa funzione). */
  gmailChecks?: number
}

export type AutoLinkSummary = { checked: boolean; linked: number; hinted: number }

/**
 * L'unica funzione del collegamento automatico per un contatto: con i suoi dati certi trova gli
 * altri account della stessa persona e li collega (motivo salvato), oppure lascia un suggerimento.
 * Poche letture indicizzate, nessuna AI. Facebook e chat del sito: nessun dato certo, non fa niente.
 */
export async function autoLinkContact(input: AutoLinkInput): Promise<AutoLinkSummary> {
  const summary: AutoLinkSummary = { checked: false, linked: 0, hinted: 0 }
  if (!AUTO_PLATFORMS.has(input.platform) || !input.contactId) return summary
  const self: Member = { platform: input.platform, contactId: input.contactId }
  const ctx = newCtx(input.gmailChecks ?? 1)
  let force = Boolean(input.force)

  // Dati certi arrivati con il messaggio: si salvano sempre (anche se il controllo e' gia' stato fatto oggi).
  const username = self.platform === 'instagram' ? instagramHandle(input.instagramUsername) : null
  if (username && (await rememberInstagramUsername(ctx, self, username))) force = true
  if (self.platform === 'email' && input.emailAuthenticated && !(await recordOf(ctx, self)).emailAuthAt) {
    const at = nowIso()
    await editRecord(ctx, self, (r) => (r.emailAuthAt ? false : { ...r, emailAuthAt: at }))
    force = true
  }

  const record = await recordOf(ctx, self)
  const due = force || !record.checkedAt || !(ctx.now - Date.parse(record.checkedAt) < CHECK_EVERY_MS)
  const comment = input.kind === 'comment'
  const tally: Tally = { linked: 0, hinted: 0, hintedWith: new Set(), handled: new Set() }

  // Stesso account Instagram con due id (commento e Direct): lo username lo da' Meta.
  if (self.platform === 'instagram' && record.igUsername && !OWN_INSTAGRAM.has(record.igUsername) && (due || comment)) {
    for (const id of await freshInstagramIds(ctx, record.igUsername)) {
      if (id === self.contactId) continue
      const other: Member = { platform: 'instagram', contactId: id }
      const result = await autoLink(self, other, { rule: 'ig_same_user', detail: `stesso profilo Instagram @${record.igUsername} (indicato da Instagram)` }, { ctx })
      if (result.linked) tally.linked++
      else if (result.blocked === 'conflict') {
        tally.hinted++
        tally.hintedWith.add(memberKey(other))
      }
    }
  }
  summary.linked = tally.linked
  summary.hinted = tally.hinted

  // Commenti: solo lo username (sopra); le schede si controllano dai messaggi privati.
  if (comment || !due) return summary
  // Chi in questo messaggio dice di conoscerci: decide la verifica con il codice, non il collegamento con le schede.
  if (input.text && detectClaim(input.text, self.platform)) return summary

  await leadRules(ctx, self, tally)
  await bookingHints(ctx, self, tally)

  const at = nowIso()
  const by = memberKey(self)
  // Suggerimenti scritti da questo contatto in controlli precedenti e non piu' validi: si tolgono.
  await editRecord(ctx, self, (r) => ({ ...r, checkedAt: at, hints: (r.hints || []).filter((h) => h.by !== by || tally.hintedWith.has(h.with) || h.separated) }))
  summary.checked = true
  summary.linked = tally.linked
  summary.hinted = tally.hinted
  return summary
}

// ---------------------------------------------------------------------
// Conversazioni esistenti: controllo a piccoli passi dal cron (una volta sola, poi solo schede nuove)
// ---------------------------------------------------------------------

type BackfillState = {
  cursor?: { at: string; id: string }
  startedAt?: string
  doneAt?: string
  nextAt?: string
  leaseUntil?: string
  scanned?: number
  linked?: number
  hinted?: number
  updatedAt?: string
}
const parseBackfill = (raw: string | null): BackfillState => parseJson<BackfillState>(raw, {}, isObject)

const BACKFILL_PAGE = 100
/** Finito il giro completo, si guardano solo le schede nuove ogni qualche ora. */
const BACKFILL_IDLE_MS = 6 * 3_600_000

/**
 * Passo del controllo delle conversazioni gia' esistenti: scorre le schede Clienti (dalla piu'
 * vecchia, con un segnaposto in app_settings) e, per quelle con un contatto vero e almeno due
 * canali, controlla le conversazioni con autoLinkContact. Si ferma entro budgetMs e riprende al
 * giro successivo; a fine giro guarda solo le schede nuove, ogni 6 ore.
 */
export async function autoLinkBackfillTick(budgetMs = 8_000): Promise<void> {
  const started = Date.now()
  let state: BackfillState | null = null
  await updateSetting(BACKFILL_KEY, parseBackfill, (current) => {
    state = null
    if (current.leaseUntil && Date.parse(current.leaseUntil) > started) return false
    if (current.nextAt && Date.parse(current.nextAt) > started) return false
    state = { ...current, leaseUntil: new Date(started + 55_000).toISOString(), startedAt: current.startedAt || new Date(started).toISOString() }
    return state
  })
  const run = state as BackfillState | null
  if (!run) return

  let cursor = run.cursor
  let scanned = run.scanned || 0
  let linked = run.linked || 0
  let hinted = run.hinted || 0
  let reachedEnd = false
  try {
    const ctx = newCtx()
    while (Date.now() - started < budgetMs) {
      const cutoff = new Date(Date.now() - RECORD_MIN_AGE_MS).toISOString()
      let query = supabaseAdmin
        .from('leads')
        .select(LEAD_COLS)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(BACKFILL_PAGE)
      if (cursor) query = query.or(`created_at.gt."${cursor.at}",and(created_at.eq."${cursor.at}",id.gt.${cursor.id})`)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      const page = (data || []) as LeadRow[]
      for (const lead of page) {
        if (Date.now() - started >= budgetMs) break
        cursor = { at: lead.created_at, id: lead.id }
        scanned++
        if (!leadSince(lead, cutoff)) continue
        const phone = lead.phone ? normalizePhone(lead.phone) : null
        const email = cleanEmail(lead.email)
        const handle = lead.search_query === SOURCE_MANUAL ? instagramHandle(lead.instagram) : null
        const starts: Member[] = []
        if (phone) starts.push({ platform: 'whatsapp', contactId: phone })
        if (email && usableTarget(email)) starts.push({ platform: 'email', contactId: email })
        if (handle && !OWN_INSTAGRAM.has(handle)) for (const id of await freshInstagramIds(ctx, handle)) starts.push({ platform: 'instagram', contactId: id })
        if (new Set(starts.map((m) => m.platform)).size < 2) continue
        for (const m of starts) {
          if (!(await conversationState(m))) continue
          const result = await autoLinkContact({ platform: m.platform, contactId: m.contactId, force: true, gmailChecks: 2 })
          linked += result.linked
          hinted += result.hinted
        }
      }
      if (page.length < BACKFILL_PAGE && (!page.length || cursor?.id === page[page.length - 1].id)) {
        reachedEnd = true
        break
      }
    }
  } catch (error) {
    console.error('collegamento automatico, conversazioni esistenti:', error)
  } finally {
    const at = nowIso()
    await updateSetting(BACKFILL_KEY, parseBackfill, (current) => ({
      ...current,
      cursor,
      scanned,
      linked,
      hinted,
      leaseUntil: undefined,
      doneAt: current.doneAt || (reachedEnd ? at : undefined),
      nextAt: reachedEnd ? new Date(Date.now() + BACKFILL_IDLE_MS).toISOString() : undefined,
      updatedAt: at,
    })).catch((error) => console.error('collegamento automatico, avanzamento:', error))
  }
}

// ---------------------------------------------------------------------
// Casella Messaggi
// ---------------------------------------------------------------------

export type AutoLinkInfo = { links: LinkNote[]; hints: LinkHint[] }

/** Motivi dei collegamenti automatici e suggerimenti degli account indicati (quelli in elenco). */
export async function loadAutoLinkInfo(memberKeys: string[]): Promise<Map<string, AutoLinkInfo>> {
  const map = new Map<string, AutoLinkInfo>()
  const keys = [...new Set(memberKeys)].map((k) => `${RECORD_PREFIX}${k}`)
  const now = Date.now()
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').in('key', keys.slice(i, i + 100))
    if (error) continue
    for (const row of data || []) {
      if (!row.key.startsWith(RECORD_PREFIX)) continue
      const record = parseRecord(row.value)
      const links = (record.links || []).filter((n) => n && typeof n.with === 'string' && typeof n.detail === 'string')
      const hints = (record.hints || []).filter((h) => h && typeof h.with === 'string' && typeof h.detail === 'string' && now - Date.parse(h.at) < HINT_TTL_MS)
      if (links.length || hints.length) map.set(row.key.slice(RECORD_PREFIX.length), { links, hints })
    }
  }
  return map
}
