import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADMIN_EMAILS } from '@/lib/admin-auth'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { conversationKeyFor } from '@/lib/meta/identities'

const LABEL = { whatsapp: 'WhatsApp', facebook: 'Messenger', instagram: 'Instagram', email: 'Email' } as const
const EMAIL_QUIET_MINUTES = 10

/** Avvisa gli admin di un nuovo messaggio: push sempre, email al massimo una ogni 10 minuti per contatto. */
export async function notifyNewMessage(input: {
  platform: keyof typeof LABEL
  kind: 'message' | 'comment'
  contactId: string
  contactName: string | null
  body: string
  messageId: string
  hasPendingDraft: boolean
}) {
  const channel = input.kind === 'comment' ? `commento ${LABEL[input.platform]}` : LABEL[input.platform]
  const who = input.contactName || 'Nuovo contatto'
  const key = await conversationKeyFor(input.platform, input.contactId)
  const url = `${SITE_URL}/admin/inbox?c=${encodeURIComponent(key)}`
  const preview = input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body
  const action = input.hasPendingDraft ? 'Risposta AI pronta da approvare.' : ''

  const tasks: Promise<unknown>[] = [
    sendPushToAdmins({
      title: `${who} · ${channel}`,
      body: [preview, action].filter(Boolean).join('\n'),
      url,
      tag: key,
    }).then((result) => console.log(`push ${channel} da ${who}: ${result.sent} inviate, ${result.failed} fallite`)),
  ]

  const since = new Date(Date.now() - EMAIL_QUIET_MINUTES * 60_000).toISOString()
  const { count } = await supabaseAdmin
    .from('social_messages')
    .select('id', { count: 'exact', head: true })
    .eq('platform', input.platform)
    .eq('contact_id', input.contactId)
    .eq('direction', 'in')
    .neq('id', input.messageId)
    .gte('created_at', since)

  // Per le email niente avviso via email: arriverebbe nella stessa casella letta dall'agente.
  if (!count && input.platform !== 'email') {
    tasks.push(
      sendEmail({
        to: [...ADMIN_EMAILS],
        subject: `Nuovo messaggio ${channel} da ${who}`,
        text: `${who} ti ha scritto su ${channel}:\n\n${input.body}\n\n${action}\nApri la casella: ${url}`,
        html: emailLayout(`
<p><strong>${escapeHtml(who)}</strong> ti ha scritto su <strong>${escapeHtml(channel)}</strong>:</p>
<div style="background: #f5f5f5; border-left: 4px solid #1d4fa3; padding: 12px 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(input.body)}</div>
${action ? `<p>${escapeHtml(action)}</p>` : ''}
<p><a href="${url}" style="display: inline-block; background: #0b1f3a; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">Apri la casella messaggi</a></p>`),
      })
    )
  }

  await Promise.allSettled(tasks)
}
