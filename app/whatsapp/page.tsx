import type { Metadata } from 'next'
import InboxView from '../admin/inbox/InboxView'

// Chat WhatsApp in una pagina a sé (stesso accesso dei Messaggi). Mai indicizzata.
export const metadata: Metadata = {
  title: 'WhatsApp · Facevoice AI',
  robots: { index: false, follow: false },
}

export default function WhatsAppPage() {
  return <InboxView scope="whatsapp" />
}
