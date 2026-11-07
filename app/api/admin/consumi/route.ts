import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { betaProjectId, getAnthropicCost, getBilling, getMonitoring, googleAccessMode, type GoogleRequest } from '@/lib/google-usage'
import { getAutopilotInfo, getBetaUsersUsage, getSiteAiUsage } from '@/lib/consumi-server'
import { buildTips, placesAttributionFrom, type ConsumiResponse } from '@/lib/consumi'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Consumi reali per la pagina /admin/consumi (solo admin). Ogni fonte ha la sua
// memoria breve sul server (Monitoring 60 s, fatturazione 5 min, Anthropic 15 min,
// beta 60 s): la pagina puo' chiedere spesso senza chiamare Google ogni volta.
//   ?parte=ora           solo le richieste di Google (pannello "Ultima ora", ogni 60 s)
//   ?parte=ripartizione  solo i dati per ripartire il costo Places (pagina Utenti)
//
// Accesso a Google senza chiave: Vercel mette il suo token OIDC nell'header
// x-vercel-oidc-token di ogni richiesta; si passa a lib/google-usage (che, se manca,
// prova VERCEL_OIDC_TOKEN). Mai nella risposta o nei log.

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const part = req.nextUrl.searchParams.get('parte')
  const betaProject = betaProjectId()
  const google: GoogleRequest = { vercelToken: req.headers.get('x-vercel-oidc-token') }

  if (part === 'ora') {
    return NextResponse.json({ monitoring: await getMonitoring(Date.now(), google) }, { headers: noStore })
  }

  if (part === 'ripartizione') {
    const [monitoring, billing] = await Promise.all([getMonitoring(Date.now(), google), getBilling(Date.now(), google)])
    const places = placesAttributionFrom(
      monitoring.status === 'ok' ? monitoring.data : null,
      billing.status === 'ok' ? billing.data : null,
      betaProject
    )
    return NextResponse.json({ places, lastExport: billing.status === 'ok' ? billing.data.lastExport : null }, { headers: noStore })
  }

  const [monitoring, billing, anthropic, users, site, autopilot] = await Promise.all([
    getMonitoring(Date.now(), google),
    getBilling(Date.now(), google),
    getAnthropicCost(),
    getBetaUsersUsage(),
    getSiteAiUsage(),
    getAutopilotInfo(),
  ])
  const m = monitoring.status === 'ok' ? monitoring.data : null
  const b = billing.status === 'ok' ? billing.data : null
  const body: ConsumiResponse = {
    updatedAt: new Date().toISOString(),
    monitoring,
    billing,
    anthropic,
    users,
    site,
    autopilot,
    places: placesAttributionFrom(m, b, betaProject),
    tips: buildTips({
      monitoring: m,
      billing: b,
      users: users.status === 'ok' ? users.data : null,
      site: site.status === 'ok' ? site.data : null,
      autopilot,
    }),
    betaProject,
    googleAccess: googleAccessMode(),
  }
  return NextResponse.json(body, { headers: noStore })
}
