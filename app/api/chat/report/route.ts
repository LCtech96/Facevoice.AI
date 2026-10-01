import { NextRequest, NextResponse } from 'next/server'
import { ChatAuthError, requireChatMember } from '@/lib/chat-auth'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const TYPES = {
  bug: 'Bug',
  problem: 'Problema',
  change: 'Richiesta di modifica',
} as const

type ReportType = keyof typeof TYPES

export async function POST(req: NextRequest) {
  try {
    const member = await requireChatMember(req)
    const body = await req.json().catch(() => ({}))

    const type: ReportType = body?.type in TYPES ? body.type : 'problem'
    const subject = String(body?.subject || '').trim().slice(0, 150)
    const message = String(body?.message || '').trim().slice(0, 5000)
    const context = String(body?.context || '').trim().slice(0, 300)

    if (!message) {
      return NextResponse.json({ error: 'Descrivi il problema prima di inviare.' }, { status: 400 })
    }

    const label = TYPES[type]
    const who = member.display_name ? `${member.display_name} <${member.email}>` : member.email
    const title = `[Chat AI · ${label}] ${subject || message.slice(0, 60)}`

    const sent = await sendEmail({
      to: [...ADMIN_EMAILS],
      replyTo: member.email,
      subject: title,
      text: [
        `Tipo: ${label}`,
        `Da: ${who}`,
        subject ? `Oggetto: ${subject}` : '',
        context ? `Contesto: ${context}` : '',
        '',
        message,
      ].filter(Boolean).join('\n'),
      html: emailLayout(`
<h2 style="margin: 0 0 12px;">Nuova segnalazione dalla chat AI</h2>
<p><strong>Tipo:</strong> ${escapeHtml(label)}<br>
<strong>Da:</strong> ${escapeHtml(who)}${subject ? `<br><strong>Oggetto:</strong> ${escapeHtml(subject)}` : ''}${context ? `<br><strong>Contesto:</strong> ${escapeHtml(context)}` : ''}</p>
<div style="background: #f5f5f5; border-left: 4px solid #1d4fa3; padding: 12px 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(message)}</div>
<p style="color: #666; font-size: 13px;">Rispondi a questa email per scrivere direttamente a chi ha inviato la segnalazione.</p>`),
    })

    if (!sent) {
      return NextResponse.json(
        { error: 'Invio non riuscito. Riprova più tardi o scrivi a assistenza@facevoice.ai.' },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Chat report error:', error)
    return NextResponse.json({ error: 'Errore nell’invio della segnalazione.' }, { status: 500 })
  }
}
