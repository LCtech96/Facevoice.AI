import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { boardLinkOf, claimDoneNotice, claimInvite, releaseInvite, type BoardRow, type MemberRow } from '@/lib/todo-store'
import { formatRome, priorityLabel } from '@/lib/todo-shared'

// Avviso all'admin quando una persona (non l'admin) segna un'attivita' come fatta o la
// sposta nella tabella "Fatto": chi, cosa, da quale tabella a quale, e il link alla
// todo list nel pannello admin per controllare. Un solo avviso per attivita' anche se
// viene spostata avanti e indietro in pochi minuti. Parte dopo la risposta: se l'email
// non parte, lo spostamento resta comunque fatto.

export type DoneNoticeInput = {
  board: Pick<BoardRow, 'id' | 'name'>
  who: string
  taskId: string
  fromListId: string
  toListId: string
  origin: string
  at?: number
}

type NoticeTask = { title: string; notes: string; priority: number; deadline: string | null }

export function doneEmail(input: { boardName: string; boardId: string; who: string; task: NoticeTask; fromList: string; toList: string; origin: string; at: number }) {
  const { boardName, boardId, who, task, fromList, toList, origin, at } = input
  const link = `${origin}/admin/todo/${encodeURIComponent(boardId)}`
  const notes = task.notes.replace(/\s+/g, ' ').trim()
  const excerpt = notes.length > 280 ? `${notes.slice(0, 280)}…` : notes
  const when = formatRome(new Date(at).toISOString(), true)
  const moved = fromList !== toList
  const subject = `${who} ha finito «${task.title}»`
  const line = moved ? `${who} ha spostato l’attività «${task.title}» da «${fromList}» a «${toList}».` : `${who} ha segnato come fatta l’attività «${task.title}» (tabella «${toList}»).`
  const rows: [string, string][] = [
    ['Chi', who],
    ['Attività', task.title],
    ...(excerpt ? ([['Note', excerpt]] as [string, string][]) : []),
    ['Tabella', moved ? `da «${fromList}» a «${toList}»` : toList],
    ['Todo list', boardName],
    ['Importanza', priorityLabel(task.priority)],
    ['Scadenza', task.deadline ? `${formatRome(task.deadline, true)} (ora italiana)` : 'nessuna'],
    ['Quando', `${when} (ora italiana)`],
  ]
  const text = [line, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Controlla nella todo list: ${link}`].join('\n')
  const html = emailLayout(`
<p>${escapeHtml(line)}</p>
<table style="border-collapse: collapse; margin: 16px 0;">
${rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">${escapeHtml(k)}</td><td style="padding: 4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`).join('\n')}
</table>
<p><a href="${escapeHtml(link)}" style="display: inline-block; background: #007AFF; color: #fff; padding: 10px 18px; border-radius: 999px; text-decoration: none;">Apri la todo list</a></p>`)
  return { subject, text, html }
}

/** Manda l'avviso (se non e' gia' partito da poco). Mai un errore verso chi ha spostato. */
export async function notifyTaskDone(input: DoneNoticeInput): Promise<boolean> {
  const at = input.at ?? Date.now()
  if (!(await claimDoneNotice(input.board.id, input.taskId, at))) return false
  const [{ data: task }, { data: lists }] = await Promise.all([
    supabaseAdmin.from('todo_tasks').select('title, notes, priority, deadline').eq('id', input.taskId).eq('board_id', input.board.id).maybeSingle(),
    supabaseAdmin.from('todo_lists').select('id, title').eq('board_id', input.board.id).in('id', [input.fromListId, input.toListId]),
  ])
  if (!task) return false
  const titles = new Map(((lists || []) as { id: string; title: string }[]).map((l) => [l.id, l.title]))
  const mail = doneEmail({
    boardName: input.board.name,
    boardId: input.board.id,
    who: input.who,
    task: task as NoticeTask,
    fromList: titles.get(input.fromListId) || 'tabella eliminata',
    toList: titles.get(input.toListId) || 'tabella eliminata',
    origin: input.origin,
    at,
  })
  return sendEmail({ to: ADMIN_EMAILS[0], ...mail })
}

// ---------------------------------------------------------------------
// Invito a chi riceve un'attivita': link della todo list e nome con cui entrare
// ---------------------------------------------------------------------

type InviteTask = { title: string; deadline: string | null }

/** Email di invito: todo list, attivita' assegnate (con la scadenza), link e nome per entrare. Password solo se l'admin lo chiede. */
export function inviteEmail(input: { boardName: string; name: string; tasks: InviteTask[]; link: string | null; password?: string | null }) {
  const { boardName, name, tasks, link, password } = input
  const one = tasks.length === 1
  const subject = one ? `Ti è stata assegnata un’attività: «${tasks[0].title}»` : `Ti sono state assegnate ${tasks.length} attività in «${boardName}»`
  const intro = one ? `ti è stata assegnata un’attività nella todo list «${boardName}».` : `ti sono state assegnate ${tasks.length} attività nella todo list «${boardName}».`
  const line = (t: InviteTask) => (t.deadline ? `${t.title} (scadenza: ${formatRome(t.deadline, true)}, ora italiana)` : t.title)
  const access = [`Accedi con il nome: ${name}`, password ? `Password: ${password}` : 'Password: quella che ti ha dato chi ti ha assegnato l’attività.']
  const text = [
    `Ciao ${name},`,
    '',
    intro,
    '',
    ...tasks.map((t) => `- ${line(t)}`),
    '',
    link ? `Apri la todo list: ${link}` : '',
    ...access,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
  const html = emailLayout(`
<p>Ciao ${escapeHtml(name)},</p>
<p>${escapeHtml(intro)}</p>
<ul style="margin: 12px 0; padding-left: 20px;">
${tasks.map((t) => `<li style="margin: 4px 0;"><strong>${escapeHtml(t.title)}</strong>${t.deadline ? ` <span style="color: #666;">(scadenza: ${escapeHtml(formatRome(t.deadline, true))}, ora italiana)</span>` : ''}</li>`).join('\n')}
</ul>
${link ? `<p><a href="${escapeHtml(link)}" style="display: inline-block; background: #007AFF; color: #fff; padding: 10px 18px; border-radius: 999px; text-decoration: none;">Apri la todo list</a></p>` : ''}
<p>Accedi con il nome: <strong>${escapeHtml(name)}</strong><br>${password ? `Password: <strong>${escapeHtml(password)}</strong>` : 'Password: quella che ti ha dato chi ti ha assegnato l’attività.'}</p>`)
  return { subject, text, html }
}

/** Com'e' andato l'invito: mandato, non partito, gia' mandato prima, o persona senza email. */
export type InviteStatus = 'sent' | 'failed' | 'already' | 'no-email'

/**
 * Manda UNA email alla persona con le attivita' appena assegnate a lei (quelle per cui
 * non l'ha gia' ricevuta). force: si manda anche per quelle gia' avvisate (l'admin ha
 * chiesto di mandare la password nuova). Mai un errore verso chi salva.
 */
export async function notifyAssigned(input: { board: Pick<BoardRow, 'id' | 'name' | 'token_enc'>; member: MemberRow; taskIds: string[]; origin: string; password?: string | null }): Promise<InviteStatus> {
  const { board, member, origin } = input
  const to = member.email
  if (!to) return 'no-email'
  const force = Boolean(input.password)
  const claimed: string[] = []
  const send: string[] = []
  for (const taskId of input.taskIds) {
    const r = await claimInvite(board.id, taskId, member.id).catch(() => 'free' as const)
    if (r === 'claimed') claimed.push(taskId)
    if (r !== 'done' || force) send.push(taskId)
  }
  if (!send.length) return 'already'
  const release = () => Promise.all(claimed.map((id) => releaseInvite(board.id, id, member.id).catch(() => undefined)))
  try {
    const { data } = await supabaseAdmin.from('todo_tasks').select('id, title, deadline, assignee_member').eq('board_id', board.id).in('id', send)
    const tasks = ((data || []) as (InviteTask & { id: string; assignee_member: string | null })[]).filter((t) => t.assignee_member === member.id)
    if (!tasks.length) {
      await release()
      return 'already'
    }
    const order = new Map(send.map((id, i) => [id, i]))
    tasks.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    const mail = inviteEmail({ boardName: board.name, name: member.name, tasks, link: boardLinkOf(board, origin), password: input.password })
    const ok = await sendEmail({ to, ...mail }).catch(() => false)
    if (!ok) await release()
    return ok ? 'sent' : 'failed'
  } catch {
    await release()
    return 'failed'
  }
}
