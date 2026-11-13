import InboxView from './InboxView'

// Messaggi: tutti i canali tranne le chat solo WhatsApp, che stanno su /whatsapp.
export default function InboxPage() {
  return <InboxView scope="inbox" />
}
