// Font pronti da scegliere per il marchio (pagina Istruzioni). I file sono in
// lib/fonts/presets (<id>-regular.woff e <id>-bold.woff, sottoinsieme "latin" con le
// lettere accentate); licenze SIL OFL (Roboto Slab: Apache 2.0) in lib/fonts/presets/licenses.

export const FONT_PRESETS = [
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', kind: 'Moderno' },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', kind: 'Moderno' },
  { id: 'raleway', label: 'Raleway', family: 'Raleway', kind: 'Moderno' },
  { id: 'nunito', label: 'Nunito', family: 'Nunito', kind: 'Morbido' },
  { id: 'josefin-sans', label: 'Josefin Sans', family: 'Josefin Sans', kind: 'Geometrico' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', kind: 'Stretto' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: 'Bebas Neue', kind: 'Solo maiuscole, per titoli' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', kind: 'Elegante' },
  { id: 'dm-serif-display', label: 'DM Serif Display', family: 'DM Serif Display', kind: 'Elegante, per titoli' },
  { id: 'lora', label: 'Lora', family: 'Lora', kind: 'Classico' },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', kind: 'Classico' },
  { id: 'roboto-slab', label: 'Roboto Slab', family: 'Roboto Slab', kind: 'Robusto' },
  { id: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script', kind: 'Corsivo, per titoli' },
] as const

export type FontPresetId = (typeof FONT_PRESETS)[number]['id']

export const fontPreset = (id: unknown) => FONT_PRESETS.find((f) => f.id === id) || null
