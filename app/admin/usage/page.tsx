import { redirect } from 'next/navigation'

// I consumi ora sono in alto nella Super chat; i dipendenti in Gestione.
export default function UsageRedirect() {
  redirect('/admin/assistant')
}
