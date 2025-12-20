// Informazioni dettagliate sugli AI Tools basate su documentazione, pricing e recensioni
export interface ToolDetailedInfo {
  id: string
  name: string
  pricing: {
    free?: boolean
    plans?: Array<{
      name: string
      price: string
      description: string
    }>
  }
  bestFor: string[]
  strengths: string[]
  limitations: string[]
  useCase: string
  documentation?: string
}

export const AI_TOOLS_DETAILED_INFO: Record<string, ToolDetailedInfo> = {
  'higgsfield': {
    id: 'higgsfield',
    name: 'Higgsfield',
    pricing: {
      free: true,
    },
    bestFor: ['Face swap istantaneo', 'Generazione stile rapida', 'Lavoro da browser'],
    strengths: [
      'Estensione Chrome gratuita - accesso diretto da qualsiasi pagina web',
      'Face swap con un click - molto veloce',
      'Soul Recreation per ricreare stili da immagini',
      'Nessun download necessario - tutto nel browser',
      '4.6/5 stelle su Chrome Web Store con 10k+ utenti',
    ],
    limitations: [
      'Limitato a funzionalità browser',
      'Meno controllo avanzato rispetto a software dedicati',
    ],
    useCase: 'Perfetto per creator che vogliono risultati istantanei mentre navigano social media o raccolgono ispirazione. Ideale per face swap rapidi e generazione di stile da riferimenti trovati online.',
    documentation: 'https://chromewebstore.google.com/publisher/higgsfield-inc/udef4921ac193f0bad2993b4e85f34760',
  },
  'runway': {
    id: 'runway',
    name: 'Runway',
    pricing: {
      free: true,
      plans: [
        {
          name: 'Free',
          price: '$0/mese',
          description: '125 crediti one-time, 25s Gen-4 Turbo, 5GB storage, no watermark removal',
        },
        {
          name: 'Standard',
          price: '$12/mese ($144/anno)',
          description: '625 crediti/mese, accesso a tutti i modelli video, 100GB storage, watermark removal',
        },
        {
          name: 'Pro',
          price: '$28/mese ($336/anno)',
          description: '2250 crediti/mese, custom voices, 500GB storage',
        },
        {
          name: 'Unlimited',
          price: '$76/mese ($912/anno)',
          description: '2250 crediti base + unlimited generations in Explore mode',
        },
      ],
    },
    bestFor: ['Video professionali', 'VFX avanzati', 'Produzioni cinematografiche'],
    strengths: [
      'Gen-4.5 considerato il miglior modello video AI al mondo',
      'Qualità cinematografica e controlli precisi',
      'Suite completa: video generation, editing (Aleph), VFX',
      'Usato da grandi studi (es. Lionsgate partnership)',
      'Piano free generoso per iniziare',
    ],
    limitations: [
      'Piano free limitato (solo 125 crediti one-time)',
      'Costo elevato per uso intensivo (Unlimited a $76/mese)',
      'Curva di apprendimento più alta per funzionalità avanzate',
    ],
    useCase: 'Eccellente per professionisti e studi che necessitano della massima qualità video. La partnership con Lionsgate dimostra l\'adozione a livello enterprise. Gen-4.5 offre motion quality e visual fidelity superiori rispetto alla concorrenza.',
    documentation: 'https://runwayml.com/',
  },
  'domoai': {
    id: 'domoai',
    name: 'DomoAI',
    pricing: {
      free: true,
      plans: [
        {
          name: 'Free Plan',
          price: 'Gratuito',
          description: 'Crediti gratuiti per iniziare, uso commerciale permesso',
        },
      ],
    },
    bestFor: ['Video animati', 'Stili anime', 'Creazione contenuti social'],
    strengths: [
      'Piano gratuito con uso commerciale consentito',
      'Specializzato in stili anime e animazioni',
      'Community attiva (3M+ creators su Discord)',
      'Template pronti per effetti virali (Kiss, Hug, Loop)',
      'Background removal avanzato',
    ],
    limitations: [
      'Principalmente orientato a stili artistici/anime',
      'Meno adatto per video realistici professionali',
    ],
    useCase: 'Perfetto per content creator che vogliono video animati e stili artistici, specialmente per social media. La community Discord offre supporto e ispirazione. Uso commerciale permesso anche nel piano free.',
    documentation: 'https://www.domoai.app/',
  },
  'synthesia': {
    id: 'synthesia',
    name: 'Synthesia',
    pricing: {
      free: false,
    },
    bestFor: ['Video aziendali', 'Formazione', 'Video multilingua'],
    strengths: [
      'Avatar parlanti molto realistici',
      'Oltre 120 lingue supportate',
      'Perfetto per video aziendali e training',
      'API disponibile per integrazione',
      'Qualità professionale',
    ],
    limitations: [
      'Focalizzato principalmente su talking head',
      'Pricing non pubblicato (richiede contatto)',
      'Meno adatto per video creativi/generativi',
    ],
    useCase: 'Ideale per aziende che necessitano video formativi o comunicativi con avatar multilingua. Perfetto per sostituire video di formazione tradizionali o creare contenuti localizzati facilmente.',
    documentation: 'https://www.synthesia.io/',
  },
  'pika': {
    id: 'pika',
    name: 'Pika Labs',
    pricing: {
      free: false,
    },
    bestFor: ['Generazione video da testo', 'Video creativi'],
    strengths: [
      'Generazione video da prompt testuali o immagini',
      'Controllo preciso su movimento e stile',
      'Qualità elevata',
    ],
    limitations: [
      'Pricing non completamente trasparente (solo su richiesta)',
      'Meno feature avanzate rispetto a Runway',
    ],
    useCase: 'Buona alternativa a Runway per generazione video base. Adatto per progetti creativi che necessitano controllo su movimento e stile attraverso prompt.',
    documentation: 'https://pika.art/',
  },
  'google-veo': {
    id: 'google-veo',
    name: 'Google Veo',
    pricing: {
      free: false,
    },
    bestFor: ['Video ad alta qualità', 'Progetti Google ecosystem'],
    strengths: [
      'Potenza di Google AI',
      'Alta qualità video',
      'Integrazione con ecosistema Google',
    ],
    limitations: [
      'Accesso limitato (sperimentale)',
      'Pricing e disponibilità non chiari',
      'Meno documentazione pubblica',
    ],
    useCase: 'Per utenti che già utilizzano prodotti Google e vogliono integrare generazione video. Accesso attualmente limitato, meglio per early adopters.',
    documentation: 'https://ai.google.dev/',
  },
  'kling-ai': {
    id: 'kling-ai',
    name: 'Kling AI',
    pricing: {
      free: false,
    },
    bestFor: ['Video professionali', 'Controllo preciso'],
    strengths: [
      'Controlli precisi sulla generazione',
      'Qualità professionale',
      'API per sviluppatori',
    ],
    limitations: [
      'Pricing non pubblicato',
      'Meno community rispetto a Runway',
    ],
    useCase: 'Alternativa valida a Runway per chi necessita controlli precisi e integrazione API. Adatto per sviluppatori che vogliono integrare generazione video nelle proprie applicazioni.',
    documentation: 'https://klingai.com/global/',
  },
  'descript': {
    id: 'descript',
    name: 'Descript',
    pricing: {
      free: true,
      plans: [
        {
          name: 'Free',
          price: '$0/mese',
          description: '3 ore trascrizione/mese, watermark',
        },
      ],
    },
    bestFor: ['Editing video tramite testo', 'Podcast', 'Contenuti educativi'],
    strengths: [
      'Editing rivoluzionario: modifica video come testo',
      'Trascrizione automatica precisa',
      'Overdub per clonare voce',
      'Ottimo per podcast e contenuti parlati',
      'Collaborazione in tempo reale',
    ],
    limitations: [
      'Piano free molto limitato (3 ore/mese)',
      'Meno adatto per VFX avanzati',
      'Focus su contenuti basati su audio/voce',
    ],
    useCase: 'Perfetto per creator di podcast, video educativi o contenuti basati su parlato. L\'editing tramite trascrizione è rivoluzionario - elimina la necessità di timeline complesse.',
    documentation: 'https://www.descript.com/',
  },
  'opus-clip': {
    id: 'opus-clip',
    name: 'OpusClip',
    pricing: {
      free: false,
    },
    bestFor: ['Clip virali', 'Contenuti social', 'Riutilizzo video lunghi'],
    strengths: [
      'Trasforma video lunghi in clip ottimizzate per social',
      'Identifica momenti migliori automaticamente',
      'Formati ottimizzati per ogni piattaforma',
    ],
    limitations: [
      'Focalizzato su riutilizzo contenuti esistenti',
      'Non genera video da zero',
    ],
    useCase: 'Essenziale per creator che hanno video lunghi (streaming, webinar, interviste) e vogliono massimizzare il riutilizzo creando clip virali per TikTok, Reels, Shorts.',
    documentation: 'https://www.opus.pro/',
  },
  'muapi': {
    id: 'muapi',
    name: 'Muapi.ai',
    pricing: {
      free: false,
    },
    bestFor: ['Sviluppatori', 'Integrazione API', 'Effetti video programmatici'],
    strengths: [
      'API per sviluppatori',
      'Effetti video avanzati',
      'Integrazione nelle applicazioni',
    ],
    limitations: [
      'Richiede competenze tecniche',
      'Pricing non pubblicato',
      'Non per utenti finali',
    ],
    useCase: 'Per sviluppatori che vogliono integrare effetti video AI nelle proprie applicazioni o servizi. Non è un tool per utenti finali ma per integrazione tecnica.',
    documentation: 'https://muapi.ai/',
  },
  'midjourney': {
    id: 'midjourney',
    name: 'Midjourney',
    pricing: {
      free: false,
      plans: [
        {
          name: 'Basic',
          price: '$10/mese',
          description: '200 immagini/mese, accesso via Discord',
        },
        {
          name: 'Standard',
          price: '$30/mese',
          description: 'Fast generation, relax mode',
        },
        {
          name: 'Pro',
          price: '$60/mese',
          description: 'Unlimited relax mode, stealth mode',
        },
      ],
    },
    bestFor: ['Arte digitale', 'Concept art', 'Immagini artistiche'],
    strengths: [
      'Considerato il miglior modello per arte e stile artistico',
      'Qualità visiva superiore per estetica',
      'Community Discord molto attiva',
      'Prompting avanzato con parametri',
    ],
    limitations: [
      'Solo via Discord (può essere scomodo)',
      'Non ottimizzato per fotorealismo',
      'Pricing relativamente alto per uso intensivo',
    ],
    useCase: 'Il gold standard per immagini artistiche e creative. Perfetto per artisti digitali, concept artists, e chiunque voglia qualità estetica superiore. V6 offre controllo e qualità senza paragoni.',
    documentation: 'https://docs.midjourney.com/',
  },
  'dalle3': {
    id: 'dalle3',
    name: 'DALL·E 3',
    pricing: {
      free: false,
      plans: [
        {
          name: 'ChatGPT Plus',
          price: '$20/mese',
          description: 'Incluso in ChatGPT Plus, 50 generazioni al giorno',
        },
      ],
    },
    bestFor: ['Fotorealismo', 'Prompt complessi', 'Uso con ChatGPT'],
    strengths: [
      'Eccellente comprensione prompt naturale',
      'Fotorealismo superiore',
      'Integrato in ChatGPT Plus',
      'Sicurezza e content moderation avanzata',
    ],
    limitations: [
      'Richiede ChatGPT Plus (non standalone)',
      'Meno controllo artistico rispetto a Midjourney',
      'Limitato a 50 generazioni/giorno',
    ],
    useCase: 'Perfetto per chi già usa ChatGPT Plus e vuole generazione immagini integrata. Eccellente per fotorealismo e prompt complessi. La comprensione del linguaggio naturale è superiore alla concorrenza.',
    documentation: 'https://openai.com/index/dall-e-3/',
  },
  'canva': {
    id: 'canva',
    name: 'Canva (Magic Studio)',
    pricing: {
      free: true,
      plans: [
        {
          name: 'Free',
          price: '$0/mese',
          description: 'Design base, template limitati',
        },
        {
          name: 'Pro',
          price: '~$12.99/mese',
          description: 'Template illimitati, Magic Studio AI, brand kit',
        },
      ],
    },
    bestFor: ['Design grafico', 'Social media', 'Marketing visivo'],
    strengths: [
      'Suite completa design + AI',
      'Template professionali pronti',
      'Facile da usare (no-code)',
      'Magic Studio con generazione immagini AI',
      'Ottimo per non-designer',
    ],
    limitations: [
      'Meno controllo avanzato rispetto a Adobe',
      'AI meno sofisticata rispetto a tool dedicati',
      'Limitazioni nel piano free',
    ],
    useCase: 'Perfetto per creator non-designer che vogliono design professionali rapidamente. Magic Studio integra AI per generazione immagini, testo e design assistito. Eccellente per social media e marketing.',
    documentation: 'https://www.canva.com/',
  },
  'adobe-sensei': {
    id: 'adobe-sensei',
    name: 'Adobe Sensei',
    pricing: {
      free: false,
      plans: [
        {
          name: 'Creative Cloud',
          price: 'da $22.99/mese',
          description: 'Incluso in tutti i piani Creative Cloud',
        },
      ],
    },
    bestFor: ['Professionisti design', 'Workflow completi', 'Editing avanzato'],
    strengths: [
      'AI integrata in Photoshop, Illustrator, Premiere, After Effects',
      'Feature avanzate (Neural Filters, Content-Aware Fill)',
      'Workflow completo end-to-end',
      'Standard industriale',
    ],
    limitations: [
      'Pricing elevato (richiede Creative Cloud)',
      'Curva di apprendimento alta',
      'AI meno "standalone" rispetto a tool dedicati',
    ],
    useCase: 'Per professionisti che già usano Adobe Creative Cloud e vogliono AI integrata nel loro workflow esistente. Non è un tool standalone ma AI che potenzia i software Adobe esistenti.',
    documentation: 'https://business.adobe.com/ai/adobe-genai.html',
  },
}

