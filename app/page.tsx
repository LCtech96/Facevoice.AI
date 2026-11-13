import { redirect } from 'next/navigation'

// facevoice.ai apre la home dall'inizio (sulla hero), senza saltare a una sezione.
export default function RootPage() {
  redirect('/home')
}
