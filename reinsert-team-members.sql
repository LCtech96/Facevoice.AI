-- Script per reinserire i membri del team
-- Eseguire questo script nel database Supabase se i membri del team sono stati rimossi

-- Prima verifica se la tabella esiste e ha già dei membri
-- Se vuoi reinserire anche se esistono già, rimuovi il DO NOTHING

INSERT INTO team_members (name, role, description, email, linkedin, image_url) VALUES
  ('Luca Corrao', 'CEO & Founder', 'Visionary leader with expertise in AI and blockchain technologies', 'luca@facevoice.ai', 'https://linkedin.com/in/luca-corrao', '/team/Luca professionale fv.png'),
  ('Sevara Urmanaeva', 'CMO', 'Strategic marketing expert driving brand growth and digital innovation', 'sevara@facevoice.ai', 'https://linkedin.com/in/sevara-urmanaeva', '/team/Sevara professionale fv.png'),
  ('Giuseppe Delli Paoli', 'Co-founder, AI & Automation Specialist', 'Expert in AI solutions and automation systems, transforming workflows through intelligent technology', 'giuseppe@facevoice.ai', 'https://linkedin.com/in/giuseppe-delli-paoli', '/team/Giuseppe professionale fv.png'),
  ('Sara Siddique', 'Data Engineer, Data Scientist', 'Specialized in data engineering and data science, building scalable data pipelines and extracting actionable insights', 'sara@facevoice.ai', 'https://linkedin.com/in/sara-siddique', '/team/Sara professionale fv.png'),
  ('Jonh Mcnova', 'Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)', 'Expert in prompt engineering and DevOps practices, ensuring reliable and scalable infrastructure for AI systems', 'jonh@facevoice.ai', 'https://linkedin.com/in/jonh-mcnova', '/team/Jonh professionale fv.png'),
  ('Leonardo Alotta', 'Chief Financial Officer (CFO)', 'Strategic financial leader driving growth and ensuring fiscal responsibility across all business operations', 'leonardo@facevoice.ai', 'https://linkedin.com/in/leonardo-alotta', '/team/Leonardo professionale fv.png'),
  ('Abraham Caur', 'Product Manager (PM), UX/UI Designer', 'Expert in product management and UX/UI design, crafting intuitive and engaging user experiences', 'abraham@facevoice.ai', 'https://linkedin.com/in/abraham-caur', '/team/Abraham professionale fv.png')
ON CONFLICT (id) DO NOTHING;

-- Se vuoi forzare l'inserimento anche se esistono già, usa questa versione invece:
-- ON CONFLICT (id) DO UPDATE SET
--   name = EXCLUDED.name,
--   role = EXCLUDED.role,
--   description = EXCLUDED.description,
--   email = EXCLUDED.email,
--   linkedin = EXCLUDED.linkedin,
--   image_url = EXCLUDED.image_url,
--   updated_at = NOW();

