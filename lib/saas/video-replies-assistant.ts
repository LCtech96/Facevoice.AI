import type { WorkspaceDb } from '@/lib/workspace-db'
import { isWorkspaceVideo } from './video'
import {
  VideoReplyError,
  checkVideoReplyInput,
  createVideoReply,
  deleteVideoReply,
  getVideoReply,
  listVideoReplies,
  updateVideoReply,
  type VideoReply,
} from './video-replies'
import { VIDEO_REPLY_CHANNEL_LABELS, formatSize, sizeWarning, type VideoReplyChannel } from './video-replies-shared'

// Video risposte dall'Assistente: il cliente allega un video nella chat (caricamento firmato,
// come nelle Istruzioni) e dice quando mandarlo. Creare ed eliminare passano dalla scheda di
// conferma (doppia autorizzazione); elencare, cambiare, spegnere e riaccendere sono subito.
// Qui: istruzioni per l'AI, strumenti e azioni confermate (chiamate da assistant.ts e
// assistant-actions.ts, che restano invariati a parte l'aggancio).

/** Video allegato a un messaggio della chat (indirizzo dell'archivio, nome e peso dal browser). */
export type ChatVideo = { url: string; name: string; size: number }

/** Scheda del video risposta nella chat (dopo la conferma o una modifica). */
export type VideoReplyCard = { id: string; title: string; trigger: string; channels: VideoReplyChannel[]; active: boolean; oncePerPerson: boolean; url: string; warning?: string | null }
export type VideoReplyOp = 'created' | 'updated' | 'deleted'

export const VIDEO_REPLY_TOOLS = new Set(['create_video_reply', 'list_video_replies', 'update_video_reply', 'delete_video_reply'])
export const VIDEO_REPLY_OP_LABEL: Record<VideoReplyOp, string> = { created: 'creata', updated: 'modificata', deleted: 'eliminata' }

export const VIDEO_REPLIES_PROMPT = {
  tools: `- "create_video_reply": {"video": "url del video (di base quello allegato a questo messaggio o l'ultimo allegato prima)", "title": "titolo breve (es. Trattamenti, Sede di Terrasini)", "trigger": "quando mandarlo, con le parole del cliente (es. quando chiedono informazioni sui trattamenti o sui servizi)", "message": "breve messaggio da mandare con il video (facoltativo)", "channels": ["instagram","facebook"] (di base entrambi), "once_per_person": true} → PREPARA una VIDEO RISPOSTA (scheda «Conferma»: si salva solo dopo il clic): nei messaggi diretti di Instagram e Messenger, quando qualcuno chiede quella cosa, l'AI risponde e gli manda il video.
- "list_video_replies": {} → video risposte salvate con id, titolo, quando mandarle, canali, se sono attive e il peso.
- "update_video_reply": {"id": "…", e solo i campi da cambiare: "title", "trigger", "message", "channels", "active": true|false, "once_per_person": true|false} → cambia SUBITO una video risposta (anche spegnerla con "active": false o riaccenderla).
- "delete_video_reply": {"id": "…"} → PREPARA l'eliminazione di una video risposta (scheda «Elimina»).
`,
  rules: `- Video risposte (Video automazione): quando il cliente allega un video e dice quando mandarlo («quando qualcuno chiede dei trattamenti mandagli questo video», «se chiedono quanti centri abbiamo manda questo»), usa create_video_reply in questa stessa richiesta: un video = una video risposta; "trigger" con le sue parole, "title" breve scelto da te. Se allega più video, una create_video_reply per video, ognuno con il suo "trigger". Se allega un video senza dire quando mandarlo, chiedilo in una frase.
- Le video risposte partono solo nei messaggi diretti di Instagram e Messenger, mai per email e mai nei commenti. Se il risultato ha un "avviso" sul peso, dillo: il video partirà come link alla sua pagina.
- Dopo create_video_reply o delete_video_reply di' in una frase cosa hai preparato e che si salva (o si elimina) solo se tocca il pulsante sulla scheda. Per fermare un video senza eliminarlo usa update_video_reply con "active": false.`,
}

/** Video automazione spenta per chi scrive (o per il titolare): niente strumenti, e lo si dice. */
export const VIDEO_REPLIES_OFF_PROMPT = {
  tools: '',
  rules: `- Video risposte (mandare un video nei messaggi diretti quando qualcuno chiede una cosa): la Video automazione NON è attiva per questo account. Se il cliente la chiede, rispondi in una frase che non è attiva per il suo account e che può chiedere a Facevoice di attivarla. Non dire mai di averla impostata.`,
}

export const VIDEO_REPLIES_OFF_ERROR = 'la Video automazione non è attiva per questo account: dillo al cliente in una frase e che può chiedere a Facevoice di attivarla. Non è stato fatto niente.'

export const videoReplyCard = (v: VideoReply, warning?: string | null): VideoReplyCard => ({
  id: v.id,
  title: v.title,
  trigger: v.trigger,
  channels: v.channels,
  active: v.active,
  oncePerPerson: v.oncePerPerson,
  url: v.url,
  ...(warning ? { warning } : {}),
})

/** Righe per l'AI con i video allegati (questo messaggio e i precedenti della chat). */
export function chatVideoNote(current: ChatVideo | null | undefined, earlier: ChatVideo[]): string {
  const lines: string[] = []
  if (current) lines.push(`[Video allegato a questo messaggio: ${current.url} — «${current.name}», ${formatSize(current.size)}]`)
  if (earlier.length) lines.push(`[Video allegati prima in questa conversazione]\n${earlier.map((v) => `- ${v.url} — «${v.name}», ${formatSize(v.size)}`).join('\n')}`)
  return lines.join('\n\n')
}

const listLine = (v: VideoReply) => ({
  id: v.id,
  titolo: v.title,
  quando: v.trigger,
  messaggio: v.message || null,
  canali: v.channels.map((c) => VIDEO_REPLY_CHANNEL_LABELS[c]),
  attiva: v.active,
  una_volta_per_persona: v.oncePerPerson,
  peso: v.size ? formatSize(v.size) : null,
})

type Prepare = (
  kind: 'create_video_reply' | 'delete_video_reply',
  payload: Record<string, unknown>,
  view: { title: string; lines: string[]; text?: string; confirmLabel: string; doneLabel: string; video?: { url: string; title: string } },
  extra?: Record<string, unknown>
) => Promise<Record<string, unknown>>

const pickVideo = (workspaceId: string, given: unknown, current: ChatVideo | null | undefined, earlier: ChatVideo[]): ChatVideo | null => {
  const known = [current, ...[...earlier].reverse()].filter((v): v is ChatVideo => Boolean(v))
  if (typeof given === 'string' && given.trim()) {
    const url = given.trim()
    const found = known.find((v) => v.url === url)
    if (found) return found
    return isWorkspaceVideo(workspaceId, url) ? { url, name: 'video', size: 0 } : null
  }
  return known[0] ?? null
}

/** Uno strumento delle video risposte: risultato per l'AI (mai un'eccezione per errori del cliente). */
export async function videoReplyTool(
  ctx: { db: WorkspaceDb; prepare: Prepare; video?: ChatVideo | null; earlierVideos: ChatVideo[]; onCard: (op: VideoReplyOp, card: VideoReplyCard) => void },
  tool: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ws = ctx.db.workspaceId
  try {
    switch (tool) {
      case 'list_video_replies': {
        const list = await listVideoReplies(ws)
        return { video_risposte: list.map(listLine), quante: list.length }
      }
      case 'create_video_reply': {
        const video = pickVideo(ws, args.video, ctx.video, ctx.earlierVideos)
        if (!video) return { preparato: false, errore: 'manca il video: chiedi al cliente di allegarlo con il pulsante del video nella chat (MP4 o MOV)' }
        const input = checkVideoReplyInput(ws, {
          url: video.url,
          title: args.title,
          trigger: args.trigger,
          message: args.message,
          channels: args.channels,
          oncePerPerson: args.once_per_person,
        })
        const existing = (await listVideoReplies(ws)).find((v) => v.url === input.url)
        if (existing) return { preparato: false, errore: `questo video è già una video risposta («${existing.title}», id ${existing.id}): per cambiarla usa update_video_reply` }
        const warning = video.size ? sizeWarning(video.size, input.channels) : null
        return ctx.prepare(
          'create_video_reply',
          { input },
          {
            title: `Salvare la video risposta «${input.title}»`,
            lines: [
              `Quando: ${input.trigger}`,
              `Canali: ${input.channels.map((c) => VIDEO_REPLY_CHANNEL_LABELS[c]).join(' e ')}`,
              input.oncePerPerson ? 'Una sola volta per persona' : 'Anche più volte alla stessa persona',
              ...(warning ? [warning] : []),
            ],
            ...(input.message ? { text: input.message } : {}),
            confirmLabel: 'Conferma',
            doneLabel: 'Salvata',
            video: { url: input.url, title: input.title },
          },
          { salvato: false, ...(warning ? { avviso: warning } : {}) }
        )
      }
      case 'update_video_reply': {
        const id = typeof args.id === 'string' ? args.id : ''
        const { video, warning } = await updateVideoReply(ws, id, {
          title: args.title,
          trigger: args.trigger,
          message: args.message,
          channels: args.channels,
          active: args.active,
          oncePerPerson: args.once_per_person,
        })
        ctx.onCard('updated', videoReplyCard(video, warning))
        return { aggiornato: true, video_risposta: listLine(video), ...(warning ? { avviso: warning } : {}) }
      }
      case 'delete_video_reply': {
        const target = await getVideoReply(ws, typeof args.id === 'string' ? args.id : '')
        if (!target) return { eliminato: false, errore: 'video risposta non trovata: usa list_video_replies per avere l’id giusto' }
        return ctx.prepare(
          'delete_video_reply',
          { id: target.id },
          { title: `Eliminare la video risposta «${target.title}»`, lines: [`Quando: ${target.trigger}`], confirmLabel: 'Elimina', doneLabel: 'Eliminata', video: { url: target.url, title: target.title } },
          { eliminato: false }
        )
      }
      default:
        return { errore: `strumento sconosciuto: ${tool}` }
    }
  } catch (error) {
    if (error instanceof VideoReplyError) return { fatto: false, errore: error.message }
    throw error
  }
}

/** Azione confermata con il clic sulla scheda (assistant-actions.ts). */
export async function runVideoReplyAction(
  db: WorkspaceDb,
  userId: string,
  kind: 'create_video_reply' | 'delete_video_reply',
  payload: Record<string, unknown>,
  origin?: string
): Promise<{ ok: boolean; message: string; card: { op: VideoReplyOp; video: VideoReplyCard } | null }> {
  try {
    if (kind === 'create_video_reply') {
      const { video, warning } = await createVideoReply(db.workspaceId, (payload.input || {}) as Record<string, unknown>, { userId, origin })
      return {
        ok: true,
        message: `Fatto: video risposta «${video.title}» salvata. L’AI la manda ${video.trigger}.${warning ? ` ${warning}` : ''}`,
        card: { op: 'created', video: videoReplyCard(video, warning) },
      }
    }
    const removed = await deleteVideoReply(db.workspaceId, String(payload.id || ''))
    return { ok: true, message: `Fatto: video risposta «${removed.title}» eliminata.`, card: { op: 'deleted', video: videoReplyCard(removed) } }
  } catch (error) {
    if (error instanceof VideoReplyError) return { ok: false, message: `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}: non è stato fatto niente.`, card: null }
    throw error
  }
}
