import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { removeBrandFont, setBrandFont, setBrandLogo, setBrandPresetFont, setWorkspaceBrand, workspaceBrand, type WorkspaceBrand } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'

// Marchio dello spazio (pagina Istruzioni): logo, colori, font di titoli e testi, firma.
// Vale per i caroselli nuovi; quelli fatti si aggiornano tutti alla prima modifica.

const view = (b: WorkspaceBrand) => ({
  dark: b.palette.deep,
  accent: b.palette.blue,
  light: b.palette.blueLight,
  handle: b.handle,
  logo: b.logo || null,
  // Per ogni ruolo: nome, id del font della lista (se e' della lista) e se e' un font caricato.
  fonts: {
    heading: b.fonts?.heading ? { name: b.fonts.heading.name, preset: b.fonts.heading.preset || null, uploaded: Boolean(b.fonts.heading.key) } : null,
    body: b.fonts?.body ? { name: b.fonts.body.name, preset: b.fonts.body.preset || null, uploaded: Boolean(b.fonts.body.key) } : null,
  },
})

const fail = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : 'Non salvato, riprova.' }, { status: 400 })

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  return NextResponse.json({ brand: view(await workspaceBrand(access.workspace.id)) })
}

/** Colori e firma, oppure un font della lista ({ fontRole, fontPreset }; null = predefinito). */
export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  try {
    if (body.fontRole === 'heading' || body.fontRole === 'body') {
      const brand = await setBrandPresetFont(access.workspace.id, body.fontRole, typeof body.fontPreset === 'string' && body.fontPreset ? body.fontPreset : null)
      return NextResponse.json({ brand: view(brand) })
    }
    const brand = await setWorkspaceBrand(access.workspace.id, {
      dark: typeof body.dark === 'string' ? body.dark : undefined,
      accent: typeof body.accent === 'string' ? body.accent : undefined,
      light: typeof body.light === 'string' ? body.light : undefined,
      handle: typeof body.handle === 'string' ? body.handle : undefined,
    })
    return NextResponse.json({ brand: view(brand) })
  } catch (error) {
    return fail(error)
  }
}

/** Logo (immagine) o font (.ttf, .otf, .woff) per titoli, testi o tutti e due. */
export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const data = typeof body.data === 'string' && body.data.length <= 4_500_000 ? body.data.replace(/^data:[^;]*;base64,/, '') : ''
  if (!data) return fail(new Error('file mancante o troppo pesante'))
  try {
    const file = Buffer.from(data, 'base64')
    if (body.kind === 'logo') return NextResponse.json({ brand: view(await setBrandLogo(access.workspace.id, file)) })
    if (body.kind === 'font') {
      const role = body.role === 'heading' || body.role === 'body' ? body.role : 'both'
      return NextResponse.json({ brand: view(await setBrandFont(access.workspace.id, role, String(body.name || 'Font'), file)) })
    }
    return fail(new Error('tipo di file non valido'))
  } catch (error) {
    return fail(error)
  }
}

/** Toglie il logo (?what=logo) o un font (?what=heading | body). */
export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const what = req.nextUrl.searchParams.get('what')
  try {
    if (what === 'logo') return NextResponse.json({ brand: view(await setWorkspaceBrand(access.workspace.id, { logo: null })) })
    if (what === 'heading' || what === 'body') return NextResponse.json({ brand: view(await removeBrandFont(access.workspace.id, what)) })
    return fail(new Error('cosa togliere?'))
  } catch (error) {
    return fail(error)
  }
}
