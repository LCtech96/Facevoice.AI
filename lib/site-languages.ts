// Lingue del sito pubblico (le stesse del selettore in alto) e frasi fisse
// della chat che non passano dall'AI.

export const SITE_LANGUAGES = ['it', 'en', 'fr', 'ru', 'de', 'pt', 'ar', 'zh'] as const
export type SiteLanguage = (typeof SITE_LANGUAGES)[number]

/** Nome della lingua per le istruzioni all'AI. */
export const LANGUAGE_NAMES: Record<SiteLanguage, string> = {
  it: 'italiano',
  en: 'English',
  fr: 'français',
  ru: 'русский',
  de: 'Deutsch',
  pt: 'português',
  ar: 'العربية (Arabic)',
  zh: '简体中文 (Simplified Chinese)',
}

export function asSiteLanguage(value: unknown): SiteLanguage {
  return (SITE_LANGUAGES as readonly string[]).includes(String(value)) ? (value as SiteLanguage) : 'it'
}

/** Messaggio del passaggio all'operatore ({name} = ", Nome" oppure vuoto). */
export const HANDOFF_MESSAGES: Record<SiteLanguage, string> = {
  it: 'Perfetto{name}, grazie! Ti metto subito in contatto con un operatore del team: attendi qualche istante e non chiudere la chat.',
  en: 'Perfect{name}, thank you! I’m connecting you with a member of our team right now: please wait a moment and don’t close the chat.',
  fr: 'Parfait{name}, merci ! Je te mets tout de suite en contact avec un membre de l’équipe : patiente quelques instants et ne ferme pas le chat.',
  ru: 'Отлично{name}, спасибо! Сейчас соединяю вас с сотрудником нашей команды: подождите немного и не закрывайте чат.',
  de: 'Perfekt{name}, danke! Ich verbinde dich sofort mit jemandem aus unserem Team: Bitte warte einen Moment und schließe den Chat nicht.',
  pt: 'Perfeito{name}, obrigado! Vou colocar-te já em contacto com um membro da equipa: aguarda um instante e não feches o chat.',
  ar: 'ممتاز{name}، شكراً لك! سأوصلك الآن بأحد أعضاء فريقنا: يرجى الانتظار قليلاً وعدم إغلاق المحادثة.',
  zh: '太好了{name}，谢谢！我马上为你联系我们团队的工作人员：请稍等片刻，不要关闭聊天窗口。',
}
