import { NextRequest, NextResponse } from 'next/server'
import { addLibraryPhotos, deleteLibraryPhotos, listLibraryPhotos, loadAutopilotSettings, loadAutopilotState, MAX_LIBRARY_PHOTOS, updatePhotoNote } from '@/lib/photo-library'
import { listScheduledDrafts } from '@/lib/social-posts'
import { photoErrorResponse, photoGuard } from './auth'

export const dynamic = 'force-dynamic'

/** Foto della libreria, impostazioni e giri dell'autopilota, caroselli programmati o da approvare. */
export async function GET(req: NextRequest) {
  const denied = await photoGuard(req, 'view')
  if (denied) return denied
  try {
    const [photos, settings, state, carousels] = await Promise.all([listLibraryPhotos(), loadAutopilotSettings(), loadAutopilotState(), listScheduledDrafts()])
    return NextResponse.json({
      photos,
      max: MAX_LIBRARY_PHOTOS,
      settings,
      runs: state.runs.slice(-10).reverse(),
      carousels: carousels.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        scheduledAt: d.scheduledAt ?? null,
        platforms: d.platforms ?? ['instagram', 'facebook'],
        needsApproval: Boolean(d.needsApproval),
        origin: d.origin ?? 'chat',
        urls: d.urls,
        caption: d.caption,
      })),
    })
  } catch (error) {
    return photoErrorResponse(error, 'Errore nel caricare la libreria')
  }
}

/** Foto appena caricate: { items: [{ path, fileName, note?, width?, height? }] } (al massimo 50). */
export async function POST(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await addLibraryPhotos(body?.items))
  } catch (error) {
    return photoErrorResponse(error, 'Errore nel salvare le foto')
  }
}

/** Nota di una foto: { id, note }. */
export async function PATCH(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ photo: await updatePhotoNote(String(body?.id || ''), body?.note) })
  } catch (error) {
    return photoErrorResponse(error, 'Nota non salvata')
  }
}

/** Elimina foto: { ids: [...] }. */
export async function DELETE(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ deleted: await deleteLibraryPhotos(body?.ids) })
  } catch (error) {
    return photoErrorResponse(error, 'Foto non eliminate')
  }
}
