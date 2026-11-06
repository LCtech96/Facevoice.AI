import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { parseCampaignPatch, readCampaign, saveCampaign, type CampaignPlatform } from '@/lib/saas/campaign'

export const dynamic = 'force-dynamic'

// Campagna dell'Omnichat (lib/saas/campaign.ts): una per spazio. La vede tutto il
// team; la accendono, la spengono e la modificano il titolare e gli amministratori
// (come le modalita' dei canali). Il server controlla tutto: non si accende senza
// testo o senza un canale collegato scelto.

const CAMPAIGN_PLATFORMS: CampaignPlatform[] = ['email', 'instagram', 'facebook']

/** Canali collegati dello spazio (come le schede dell'Omnichat). */
async function connectedPlatforms(db: WorkspaceDb): Promise<Set<string>> {
  const { data, error } = await db.from('social_channels').select('platform, status')
  if (error) throw new Error(`canali non letti: ${error.message}`)
  return new Set(
    (data || [])
      .filter((c) => c.status === 'connected' && (CAMPAIGN_PLATFORMS as string[]).includes(c.platform as string))
      .map((c) => c.platform as string)
  )
}

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  try {
    const [campaign, connected] = await Promise.all([readCampaign(access.workspace.id), connectedPlatforms(access.db)])
    return NextResponse.json({ campaign, connected: CAMPAIGN_PLATFORMS.filter((p) => connected.has(p)) })
  } catch (error) {
    console.error('campaign read:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Campagna non disponibile, riprova.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const parsed = parseCampaignPatch(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' || body?.baseUpdatedAt === null ? (body.baseUpdatedAt as string | null) : undefined
  try {
    const connected = await connectedPlatforms(access.db)
    const result = await saveCampaign(access.workspace.id, parsed.patch, { userId: access.userId, connected, baseUpdatedAt })
    if (!result.ok) return NextResponse.json({ error: result.error, campaign: result.campaign }, { status: result.status })
    return NextResponse.json({ ok: true, campaign: result.campaign, connected: CAMPAIGN_PLATFORMS.filter((p) => connected.has(p)) })
  } catch (error) {
    console.error('campaign save:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Campagna non salvata, riprova.' }, { status: 500 })
  }
}
