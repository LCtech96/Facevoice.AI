import { supabaseAdmin } from '@/lib/supabase-admin'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { openToken } from '@/lib/todo-auth'
import { listAccesses, portalPersonFor, type AccessRow } from '@/lib/todo-access'
import { boardLink, isMissingSetup, todoOrigin } from '@/lib/todo-store'
import { formatRome, portalPath, priorityLabel, romeDay, romeToUtc } from '@/lib/todo-shared'

// Solleciti via email per le attivita' con scadenza vicina. Per ogni attivita' si
// sceglie quante email al giorno (1-6) e da quante ore prima della scadenza partire.
// Le email del giorno sono distribuite in modo regolare tra le 8:00 e le 20:00
// (ora italiana). Il cron gira ogni minuto: ogni fascia si "prenota" con una riga
// unica (attivita', giorno, fascia), quindi anche due giri sovrapposti non mandano
// mai due volte la stessa email. Attivita' fatta, cancellata o scaduta: niente piu'
// solleciti. Se l'email e' di una persona con l'accesso alla pagina generale e quel
// progetto, il link porta dritto all'attivita' nella sua pagina (senza password del
// progetto); per gli altri resta il link del singolo progetto.

const DAY_START_H = 8
const DAY_SPAN_H = 12
const MAX_HOURS_BEFORE = 168
const MAX_EMAILS_PER_RUN = 40
/** Tetto di email al giorno per todo list: chi ha il link non puo' usarla per mandare email a raffica. */
export const MAX_EMAILS_PER_BOARD_DAY = 60

/** Orari (ms) delle fasce di un giorno italiano "AAAA-MM-GG" per N solleciti al giorno. */
export function reminderSlots(day: string, perDay: number): number[] {
  const n = Math.max(1, Math.min(6, Math.floor(perDay) || 1))
  const [y, m, d] = day.split('-').map(Number)
  const step = (DAY_SPAN_H * 60) / n
  return Array.from({ length: n }, (_, i) => {
    const minutes = DAY_START_H * 60 + Math.round(i * step)
    return romeToUtc(y, m, d, Math.floor(minutes / 60), minutes % 60)
  })
}

export type ReminderTask = {
  id: string
  deadline: string | null
  done: boolean
  notify_email: string | null
  reminders_per_day: number
  remind_hours_before: number
}

export type DueSlot = { day: string; slot: number; at: number }

/** Inizio dei solleciti (ms) per un'attivita'. */
export const windowStart = (t: ReminderTask) => Date.parse(t.deadline || '') - Math.min(MAX_HOURS_BEFORE, Math.max(1, t.remind_hours_before || 24)) * 3600_000

/**
 * Fascia da usare adesso, o null. Si prende l'ultima fascia gia' iniziata (oggi o
 * ieri). Se e' precedente all'inizio dei solleciti vale solo per il primo sollecito
 * (chi crea un'attivita' alle 15 con scadenza alle 18 riceve subito il primo avviso).
 */
export function dueSlot(task: ReminderTask, now: number, sentSinceStart: boolean): DueSlot | null {
  if (task.done || !task.deadline || !task.notify_email) return null
  const deadline = Date.parse(task.deadline)
  if (!Number.isFinite(deadline)) return null
  const start = windowStart(task)
  if (now < start || now >= deadline) return null
  let best: DueSlot | null = null
  for (const day of [romeDay(now - 24 * 3600_000), romeDay(now)]) {
    reminderSlots(day, task.reminders_per_day).forEach((at, slot) => {
      if (at <= now && (!best || at > best.at)) best = { day, slot, at }
    })
  }
  if (!best) return null
  const found = best as DueSlot
  if (found.at >= start) return found
  return sentSinceStart ? null : found
}

/** "tra 3 ore", "tra 2 giorni", "tra 20 minuti". */
export function timeLeft(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `tra ${min} ${min === 1 ? 'minuto' : 'minuti'}`
  const h = Math.round(min / 60)
  if (h < 48) return `tra ${h} ${h === 1 ? 'ora' : 'ore'}`
  const d = Math.round(h / 24)
  return `tra ${d} giorni`
}

type DueTask = ReminderTask & { board_id: string; list_id: string; title: string; priority: number; assignee: string | null }

/** Link diretto all'attivita' nella pagina generale della persona. */
export const portalTaskLink = (origin: string, boardId: string, taskId: string) => `${origin}${portalPath(boardId, taskId)}`

export function reminderEmail(input: { task: DueTask; boardName: string; listTitle: string; link: string | null; now: number; portal?: boolean }) {
  const { task, boardName, listTitle, link, now, portal = false } = input
  const button = portal ? 'Apri l’attività' : 'Apri la todo list'
  const note = portal ? 'Si apre la tua pagina dei progetti, direttamente su questa attività.' : 'Per aprirla serve la password che ti è stata data.'
  const deadline = formatRome(task.deadline, true)
  const left = timeLeft(Date.parse(task.deadline || '') - now)
  const subject = `Promemoria: «${task.title}» scade ${left}`
  const rows: [string, string][] = [
    ['Attività', task.title],
    ['Todo list', boardName],
    ['Tabella', listTitle],
    ['Scadenza', `${deadline} (ora italiana)`],
    ['Importanza', priorityLabel(task.priority)],
    ['Assegnata a', task.assignee || 'nessuno'],
  ]
  const hello = task.assignee ? `Ciao ${task.assignee},` : 'Ciao,'
  const text = [
    hello,
    '',
    `l’attività «${task.title}» scade ${left}.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    link ? `${button}: ${link}` : '',
    link ? note : '',
    '',
    `Ricevi questo promemoria fino a ${task.reminders_per_day} ${task.reminders_per_day === 1 ? 'volta' : 'volte'} al giorno, finché l’attività non è segnata come fatta o non arriva la scadenza.`,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
  const html = emailLayout(`
<p>${escapeHtml(hello)}</p>
<p>l’attività <strong>«${escapeHtml(task.title)}»</strong> scade <strong>${escapeHtml(left)}</strong>.</p>
<table style="border-collapse: collapse; margin: 16px 0;">
${rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${escapeHtml(k)}</td><td style="padding: 4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`).join('\n')}
</table>
${link ? `<p><a href="${escapeHtml(link)}" style="display: inline-block; background: #007AFF; color: #fff; padding: 10px 18px; border-radius: 999px; text-decoration: none;">${escapeHtml(button)}</a></p>
<p style="color: #666; font-size: 13px;">${escapeHtml(note)}</p>` : ''}
<p style="color: #666; font-size: 13px;">Ricevi questo promemoria fino a ${task.reminders_per_day} ${task.reminders_per_day === 1 ? 'volta' : 'volte'} al giorno, finché l’attività non è segnata come fatta o non arriva la scadenza.</p>`)
  return { subject, text, html }
}

/** Un giro del cron: manda i solleciti dovuti adesso. */
export async function todoRemindersTick(requestOrigin?: string | null, now = Date.now()): Promise<{ sent: number; skipped?: string }> {
  const { data, error } = await supabaseAdmin
    .from('todo_tasks')
    .select('id, board_id, list_id, title, priority, deadline, done, assignee, notify_email, reminders_per_day, remind_hours_before')
    .eq('done', false)
    .not('deadline', 'is', null)
    .not('notify_email', 'is', null)
    .gt('deadline', new Date(now).toISOString())
    .lte('deadline', new Date(now + MAX_HOURS_BEFORE * 3600_000).toISOString())
    .order('deadline', { ascending: true })
    .limit(500)
  if (error) {
    // Tabelle non ancora create: il cron non deve riempire i log ogni minuto.
    if (isMissingSetup(error)) return { sent: 0, skipped: 'setup' }
    throw new Error(`todo solleciti: ${error.message}`)
  }
  const origin = todoOrigin(requestOrigin)
  let people: AccessRow[] | null = null
  const boards = new Map<string, { name: string; link: string | null } | null>()
  const lists = new Map<string, string>()
  let sent = 0

  for (const task of (data || []) as DueTask[]) {
    if (sent >= MAX_EMAILS_PER_RUN) break
    const start = windowStart(task)
    let slot = dueSlot(task, now, false)
    if (!slot) continue
    if (slot.at < start) {
      // Fascia di prima dell'inizio: vale solo se non e' ancora partito nessun sollecito.
      const { data: prev } = await supabaseAdmin.from('todo_reminders_sent').select('id').eq('task_id', task.id).gte('sent_at', new Date(start).toISOString()).limit(1)
      slot = dueSlot(task, now, Boolean(prev && prev.length))
      if (!slot) continue
    }
    // Mai piu' di N al giorno (anche se nel frattempo e' cambiato il numero).
    const { count } = await supabaseAdmin.from('todo_reminders_sent').select('id', { count: 'exact', head: true }).eq('task_id', task.id).eq('day', slot.day)
    if ((count || 0) >= task.reminders_per_day) continue
    const { count: boardCount } = await supabaseAdmin.from('todo_reminders_sent').select('id', { count: 'exact', head: true }).eq('board_id', task.board_id).eq('day', slot.day)
    if ((boardCount || 0) >= MAX_EMAILS_PER_BOARD_DAY) continue

    // Prenotazione della fascia: se un altro giro l'ha gia' presa, qui ci si ferma.
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('todo_reminders_sent')
      .insert({ task_id: task.id, board_id: task.board_id, day: slot.day, slot: slot.slot, email: task.notify_email })
      .select('id')
      .single()
    if (claimError || !claim) continue

    if (!boards.has(task.board_id)) {
      const { data: b } = await supabaseAdmin.from('todo_boards').select('name, token_enc').eq('id', task.board_id).maybeSingle()
      const token = b ? openToken((b as { token_enc: string }).token_enc) : null
      boards.set(task.board_id, b ? { name: (b as { name: string }).name, link: token ? boardLink(origin, token) : null } : null)
    }
    if (!lists.has(task.list_id)) {
      const { data: l } = await supabaseAdmin.from('todo_lists').select('title').eq('id', task.list_id).maybeSingle()
      lists.set(task.list_id, (l as { title: string } | null)?.title || '')
    }
    const board = boards.get(task.board_id)
    if (!board) continue
    if (people === null) people = await listAccesses().catch(() => [])
    const person = portalPersonFor(task, people)
    const link = person ? portalTaskLink(origin, task.board_id, task.id) : board.link
    const mail = reminderEmail({ task, boardName: board.name, listTitle: lists.get(task.list_id) || '', link, now, portal: Boolean(person) })
    const ok = await sendEmail({ to: task.notify_email as string, ...mail })
    if (ok) sent++
    // Invio non riuscito: la fascia si libera e il prossimo giro riprova.
    else await supabaseAdmin.from('todo_reminders_sent').delete().eq('id', (claim as { id: number }).id)
  }
  return { sent }
}
