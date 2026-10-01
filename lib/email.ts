const FROM = process.env.RESEND_FROM_EMAIL || 'FacevoiceAI <noreply@facevoice.ai>'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type EmailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
  replyTo?: string
}

/** Invia via Resend. Ritorna false (senza lanciare) se la chiave manca o l'invio fallisce. */
export async function sendEmail({ to, subject, html, text, replyTo }: EmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(`RESEND_API_KEY non configurata: email "${subject}" non inviata a ${to}`)
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      console.error('Resend error:', response.status, data)
      return false
    }
    return true
  } catch (error) {
    console.error('Errore invio email:', error)
    return false
  }
}

export function emailLayout(bodyHtml: string): string {
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a; line-height: 1.6;">
${bodyHtml}
<p style="color: #888; font-size: 12px; margin-top: 32px;">Facevoice AI &middot; www.facevoice.ai</p>
</div>`
}
