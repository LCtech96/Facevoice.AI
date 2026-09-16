import type { Metadata } from 'next'
import VerticalPage from '@/components/SEO/VerticalPage'
import { buildFaq } from '@/lib/seo/property-management'
import { ORG, SITE_URL } from '@/lib/seo/site'

const PATH = '/settori/property-management'

const INTRO = `${ORG.name} è una software house con sede a ${ORG.city}, in provincia di ${ORG.province}, che sviluppa intelligenza artificiale e automazioni su misura per il property management, gli affitti brevi e a lungo termine e le agenzie immobiliari in tutta la Sicilia e in Italia. Realizziamo assistenti AI che rispondono agli ospiti 24 ore su 24 in più lingue, automazioni della messaggistica lungo tutto il soggiorno e integrazioni con i portali e i gestionali che il cliente già usa.`

export const metadata: Metadata = {
  title:
    'AI e automazioni per property management e affitti brevi in Sicilia | Facevoice AI',
  description:
    'Software house di Palermo che sviluppa assistenti AI, automazioni di messaggistica e integrazioni su misura per property manager, affitti brevi e agenzie immobiliari in tutta la Sicilia.',
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    title: 'AI per property management e affitti brevi in Sicilia | Facevoice AI',
    description: INTRO,
    url: `${SITE_URL}${PATH}`,
    type: 'website',
  },
}

export default function PropertyManagementPage() {
  return <VerticalPage intro={INTRO} faq={buildFaq()} canonicalPath={PATH} />
}
