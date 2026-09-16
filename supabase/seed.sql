-- =====================================================================
-- Facevoice.AI — Dati iniziali
-- =====================================================================
-- Esegui DOPO supabase/schema.sql. E' idempotente (ON CONFLICT DO NOTHING).
-- =====================================================================

-- Membri del team
INSERT INTO public.team_members (name, role, description, email, linkedin, image_url) VALUES
  ('Luca Corrao', 'CEO & Founder', 'Visionary leader with expertise in AI and blockchain technologies', 'luca@facevoice.ai', 'https://linkedin.com/in/luca-corrao', '/team/Luca professionale fv.png'),
  ('Sevara Urmanaeva', 'CMO', 'Strategic marketing expert driving brand growth and digital innovation', 'sevara@facevoice.ai', 'https://linkedin.com/in/sevara-urmanaeva', '/team/Sevara professionale fv.png'),
  ('Giuseppe Delli Paoli', 'Co-founder, AI & Automation Specialist', 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology', 'giuseppe@facevoice.ai', 'https://linkedin.com/in/giuseppe-delli-paoli', '/team/Giuseppe professionale fv.png'),
  ('Sara Siddique', 'Data Engineer, Data Scientist', 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights', 'sara@facevoice.ai', 'https://linkedin.com/in/sara-siddique', '/team/Sara professionale fv.png'),
  ('Jonh Mcnova', 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)', 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems', 'jonh@facevoice.ai', 'https://linkedin.com/in/jonh-mcnova', '/team/Jonh professionale fv.png'),
  ('Leonardo Alotta', 'Chief Financial Officer (CFO)', 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations', 'leonardo@facevoice.ai', 'https://linkedin.com/in/leonardo-alotta', '/team/Leonardo professionale fv.png'),
  ('Abraham Caur', 'Product Manager (PM), UX/UI Designer', 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences', 'abraham@facevoice.ai', 'https://linkedin.com/in/abraham-caur', '/team/Abraham professionale fv.png')
ON CONFLICT DO NOTHING;

-- AI Tools del feed.
-- I contatori partono da 0 per restare coerenti con tool_likes/tool_shares:
-- valori di facciata farebbero crollare il numero al primo like reale.
INSERT INTO public.ai_tools (id, name, description, cover_image, category, likes, comments, shares) VALUES
  ('1', 'AI Chat Assistant', 'Chat intelligente con modelli LLM avanzati. Supporta multiple conversazioni, progetti organizzati e integrazione con vari modelli AI.', '/team/Trinacria.png', 'Chat & Conversazione', 0, 0, 0),
  ('2', 'Voice Recognition AI', 'Sistema avanzato di riconoscimento vocale con supporto multilingua e trascrizione in tempo reale.', '/team/Trinacria.png', 'Audio & Voice', 0, 0, 0),
  ('3', 'Image Generator AI', 'Genera immagini AI di alta qualità da descrizioni testuali. Supporta vari stili artistici e personalizzazioni.', '/team/Trinacria.png', 'Immagini & Design', 0, 0, 0),
  ('4', 'Code Assistant AI', 'Assistente per sviluppatori che aiuta a scrivere, debuggare e ottimizzare codice in vari linguaggi di programmazione.', '/team/Trinacria.png', 'Sviluppo', 0, 0, 0),
  ('5', 'Document Analyzer AI', 'Analizza e estrae informazioni da documenti PDF, Word e altri formati. Supporta OCR e analisi semantica.', '/team/Trinacria.png', 'Produttività', 0, 0, 0),
  ('6', 'Translation AI', 'Traduzione istantanea in oltre 100 lingue con supporto per contesto e tono conversazionale.', '/team/Trinacria.png', 'Linguistica', 0, 0, 0)
ON CONFLICT (id) DO NOTHING;
