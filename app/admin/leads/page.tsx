import { redirect } from 'next/navigation'

// La pagina Clienti ora vive dentro il Motore clienti (scheda "Schede").
export default function LeadsRedirect() {
  redirect('/admin/pipeline?tab=schede')
}
