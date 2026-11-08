import { NextRequest, NextResponse } from 'next/server'
import { requireAutomations } from '@/lib/automations-access'
import { deletePost } from '@/lib/saas/posts'
import { postView } from '@/lib/saas/assistant-actions'
import { LibraryError, addLibraryPhotos, createLibraryUploads, libraryView, loadLibrary, removeLibraryPhotos, updateLibraryPhoto, LIBRARY_BATCH, LIBRARY_MAX } from '@/lib/saas/photo-library'
import { AutopilotError, approveAutopilotDraft, autopilotOverview, loadAutopilot, saveAutopilot } from '@/lib/saas/photo-autopilot'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Libreria foto e Autopilota foto (pagina Automazioni). Solo per chi ha le automazioni attive
// (lib/automations-access.ts); per cambiare serve il ruolo di amministratore dello spazio.
// GET  -> foto della libreria, impostazioni dell'autopilota, ultimi caroselli
// POST action=upload_urls -> indirizzi firmati: il browser carica le foto (gia' ridotte) direttamente nell'archivio
// POST action=add         -> registra nella libreria le foto caricate
// POST action=note        -> nota su una foto
// POST action=remove      -> toglie foto dalla libreria
// POST action=settings    -> salva l'autopilota (acceso/spento, giorni, orari, foto per carosello, argomento, social, conferma)
// POST action=approve     -> programma un carosello rimasto in bozza ("chiedi conferma")
// POST action=discard     -> scarta un carosello in bozza

const failure = (error: unknown, label: string) => {
  if (error instanceof LibraryError || error instanceof AutopilotError) return NextResponse.json({ error: error.message }, { status: error.status })
  const message = error instanceof Error ? error.message : String(error)
  console.error(`app autopilota foto ${label}:`, message)
  // Errori delle funzioni dei post (data passata, social non collegato): gia' in parole semplici.
  if (label === 'approve' || label === 'discard') return NextResponse.json({ error: message.charAt(0).toUpperCase() + message.slice(1) }, { status: 400 })
  return NextResponse.json({ error: 'Libreria foto non disponibile, riprova.' }, { status: 500 })
}

async function overview(access: { db: Parameters<typeof autopilotOverview>[0]; workspace: { id: string; role: string } }) {
  const [photos, autopilot] = await Promise.all([loadLibrary(access.workspace.id), autopilotOverview(access.db)])
  return { photos: libraryView(photos), max: LIBRARY_MAX, batch: LIBRARY_BATCH, autopilot, canManage: access.workspace.role !== 'member' }
}

export async function GET(req: NextRequest) {
  const access = await requireAutomations(req)
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json(await overview(access), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return failure(error, 'elenco')
  }
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

export async function POST(req: NextRequest) {
  const access = await requireAutomations(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!body || !action) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  const ws = access.workspace.id
  try {
    switch (action) {
      case 'upload_urls':
        return NextResponse.json({ uploads: await createLibraryUploads(ws, body.files) })
      case 'add': {
        const items = Array.isArray(body.items) ? (body.items as { url?: unknown; note?: unknown }[]).map((i) => ({ url: i?.url, note: i?.note })) : []
        if (!items.length || items.length > LIBRARY_BATCH) throw new LibraryError(`Da 1 a ${LIBRARY_BATCH} foto per volta.`)
        const result = await addLibraryPhotos(ws, access.userId, items, { origin: 'page' })
        return NextResponse.json({ added: result.added.length, skipped: result.skipped, ...(await overview(access)) })
      }
      case 'note':
        if (!isId(body.id)) throw new LibraryError('Dati non validi')
        await updateLibraryPhoto(ws, body.id, { note: body.note })
        return NextResponse.json(await overview(access))
      case 'remove': {
        const removed = await removeLibraryPhotos(ws, body.ids)
        return NextResponse.json({ removed, ...(await overview(access)) })
      }
      case 'settings': {
        const { action: _a, ...input } = body
        const saved = await saveAutopilot(access.db, access.userId, input)
        return NextResponse.json({ nextRun: saved.nextRun, ...(await overview(access)) })
      }
      case 'approve': {
        if (!isId(body.postId)) throw new AutopilotError('Dati non validi')
        const post = await approveAutopilotDraft(access.db, body.postId)
        return NextResponse.json({ post: postView(post), ...(await overview(access)) })
      }
      case 'discard': {
        if (!isId(body.postId)) throw new AutopilotError('Dati non validi')
        // Solo i caroselli dell'autopilota (e non ancora usciti).
        const state = await loadAutopilot(ws)
        if (!state.log.some((e) => e.postId === body.postId)) throw new AutopilotError('Carosello non trovato.', 404)
        await deletePost(access.db, body.postId)
        return NextResponse.json(await overview(access))
      }
      default:
        return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
    }
  } catch (error) {
    return failure(error, action)
  }
}
