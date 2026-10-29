import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { listSections, saveSection, sectionState } from '@/lib/ai-context'
import { loadStyleExamples } from '@/lib/meta/agent'
import { loadOutreachReplySettings } from '@/lib/outreach-reply'
import { bookedSlotsText } from '@/lib/appointments'
// I file che definiscono i blocchi (caricarli li registra).
import '@/lib/leads'
import '@/lib/site-chat'

export const dynamic = 'force-dynamic'

/**
 * Tutto quello che l'AI usa come istruzioni e contesto: i blocchi modificabili
 * (testo in uso + predefinito) e il contesto aggiunto in automatico.
 */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'control', 'view')
  if (access instanceof NextResponse) return access

  const sections = await Promise.all(
    listSections().map(async (s) => {
      const state = await sectionState(s.id)
      return {
        id: s.id,
        title: s.title,
        usedFor: s.usedFor,
        group: s.group,
        defaultText: s.defaultText,
        text: state.text,
        custom: state.custom,
        disabled: state.custom && !state.text.trim(),
        mustContain: s.mustContain || [],
      }
    })
  )

  const [emailExamples, chatExamples, outreach, booked] = await Promise.all([
    loadStyleExamples('email').catch(() => ''),
    loadStyleExamples('instagram').catch(() => ''),
    loadOutreachReplySettings().catch(() => null),
    bookedSlotsText().catch(() => ''),
  ])

  return NextResponse.json({
    sections,
    automatic: [
      {
        title: 'Esempi di stile: email',
        where: 'Risposte alle email',
        text: emailExamples.trim() || 'Nessuno per ora.',
        how: 'Sono le ultime risposte email che hai approvato, corretto o scritto a mano in Messaggi. Cambiano da sole: per toglierne una, rispondi diversamente la prossima volta.',
      },
      {
        title: 'Esempi di stile: chat',
        where: 'Messaggi privati e commenti',
        text: chatExamples.trim() || 'Nessuno per ora.',
        how: 'Sono le ultime risposte in chat che hai approvato, corretto o scritto a mano in Messaggi.',
      },
      {
        title: 'Esempi di strategia aggiunti da te',
        where: 'Controrisposte a chi abbiamo contattato noi',
        text: outreach?.strategy?.trim() || 'Nessuno.',
        how: 'Si modificano in Motore clienti > Risposte automatiche ai contatti > Esempi di strategia.',
      },
      {
        title: 'Appuntamenti già occupati',
        where: 'Messaggi ed email (per non proporre orari presi)',
        text: booked || 'nessuno',
        how: 'Vengono dagli appuntamenti fissati (Motore clienti). Orari proposti: lun-ven 9:30-13:00 e 15:00-18:30.',
      },
      {
        title: 'Per ogni conversazione',
        where: 'Tutte le risposte',
        text:
          '- Le voci attive della Memoria AI qui sopra (informazioni ufficiali)\n- Gli ultimi messaggi scambiati con quella persona (anche su altri canali collegati)\n- Nome del profilo\n- Per i commenti: testo del commento e didascalia del post o reel\n- Per chi abbiamo contattato noi: scheda dell’attività (analisi, note) e la prima email inviata\n- Data e ora attuali\n- La lingua in cui rispondere, riconosciuta dal messaggio\n- Istruzioni tecniche fisse: riga per segnare gli appuntamenti, etichette "da controllare" e "non contattare"\n- Regola fissa sui messaggi poco chiari o assurdi: parole inventate, orari impossibili (es. "alle quintordici") o affermazioni false non si confermano mai, si chiede gentilmente di chiarire',
        how: 'Si aggiorna da solo a ogni messaggio.',
      },
    ],
  })
}

/** Modifica un blocco. body: { id, text } (text null = torna al testo originale, "" = disattivato) */
export async function PUT(req: NextRequest) {
  const access = await guard(req, 'control', 'edit')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (typeof body?.id !== 'string') return NextResponse.json({ error: 'Blocco mancante' }, { status: 400 })
  try {
    await saveSection(body.id, body.text === null ? null : String(body.text ?? ''))
    return NextResponse.json({ section: await sectionState(body.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Non salvato' }, { status: 400 })
  }
}
