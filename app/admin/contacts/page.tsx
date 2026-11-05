import { redirect } from 'next/navigation'

// La rubrica Contatti e' stata tolta: le stesse schede sono nel Motore clienti.
export default function ContactsRedirect() {
  redirect('/admin/pipeline?tab=schede')
}
