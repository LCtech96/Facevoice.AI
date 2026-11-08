import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { claimDoneNotice, type BoardRow } from '@/lib/todo-store'
import { formatRome, priorityLabel } from '@/lib/todo-shared'

// Avviso all'admin quando qualcuno che non e' l'admin (una persona entrata con nome e
// password, o chi ha il link del progetto) segna un'attivita' come fatta o la sposta
// nella tabella «Fatto»: chi, cosa, da quale tabella a quale, e il link al progetto nel
// pannello admin. Un solo avviso ogni 2 minuti per attivita'. Parte dopo la risposta:
// se l'email non parte, lo spostamento resta comunque fatto.

export const LINK_GUEST_NAME = 'qualcuno con il link del progetto'

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function doneEmail(input: { boardName: string; boardId: string; who: string; task: NoticeTask; fromList: string; toList: string; origin: string; at: number }) {
  const { boardName, boardId, who, task, fromList, toList, origin, at } = input
  const link = `${origin}/admin/todo/${encodeURIComponent(boardId)}`
  const notes = (task.notes || '').replace(/\s+/g, ' ').trim()
  const excerpt = notes.length > 280 ? `${notes.slice(0, 280)}…` : notes
  const when = formatRome(new Date(at).toISOString(), true)
  const moved = fromList !== toList
  const subject = `${cap(who)} ha finito «${task.title}» (${boardName})`
  const line = moved
    ? `${cap(who)} ha spostato l’attività «${task.title}» da «${fromList}» a «${toList}» nel progetto «${boardName}».`
    : `${cap(who)} ha segnato come fatta l’attività «${task.title}» (tabella «${toList}») nel progetto «${boardName}».`
  const rows: [string, string][] = [
    ['Chi', who],
    ['Attività', task.title],
    ...(excerpt ? ([['Note', excerpt]] as [string, string][]) : []),
    ['Tabella', moved ? `da «${fromList}» a «${toList}»` : toList],
    ['Progetto', boardName],
    ['Importanza', priorityLabel(task.priority)],
    ['Scadenza', task.deadline ? `${formatRome(task.deadline, true)} (ora italiana)` : 'nessuna'],
    ['Quando', `${when} (ora italiana)`],
  ]
  const text = [line, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Controlla nel progetto: ${link}`].join('\n')
  const html = emailLayout(`
<p>${escapeHtml(line)}</p>
<table style="border-collapse: collapse; margin: 16px 0;">
${rows.map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">${escapeHtml(k)}</td><td style="padding: 4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`).join('\n')}
</table>
<p><a href="${escapeHtml(link)}" style="display: inline-block; background: #007AFF; color: #fff; padding: 10px 18px; border-radius: 999px; text-decoration: none;">Apri il progetto</a></p>`)
  return { subject, text, html }
}

/** Manda l'avviso (se non e' gia' partito da poco). Mai un errore verso chi ha spostato. */
export async function notifyTaskDone(input: DoneNoticeInput): Promise<boolean> {
  try {
    const at = input.at ?? Date.now()
    if (!(await claimDoneNotice(input.board.id, input.taskId, at))) return false
    const [{ data: task }, { data: lists }] = await Promise.all([
      supabaseAdmin.from('todo_tasks').select('title, notes, priority, deadline').eq('id', input.taskId).eq('board_id', input.board.id).maybeSingle(),
      supabaseAdmin.from('todo_lists').select('id, title').eq('board_id', input.board.id).in('id', [...new Set([input.fromListId, input.toListId])]),
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
    return await sendEmail({ to: ADMIN_EMAILS[0], ...mail })
  } catch (error) {
    console.error('todo: avviso fatta non inviato', error instanceof Error ? error.message.slice(0, 160) : 'errore')
    return false
  }
}
