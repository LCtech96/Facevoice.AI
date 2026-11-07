// Legge il "passo" che l'AI dell'assistente deve restituire ({"tool", "args"} oppure
// {"reply"}), anche quando il modello non rispetta il formato: testo prima o dopo,
// blocchi ```json, tag inventati come <function_calls>, un array di chiamate,
// argomenti messi accanto a "tool" invece che dentro "args", graffe o virgole in piu'.
// Senza questo, una risposta malformata finiva in chat cosi' com'era (JSON compreso)
// e lo strumento non partiva.

export type ToolStep = { tool?: string; args?: Record<string, unknown>; reply?: string; [key: string]: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Pezzi di testo che iniziano con { o [ e si chiudono in modo bilanciato (le stringhe JSON contano). */
function balancedSpans(text: string, max = 25): string[] {
  const spans: string[] = []
  let start = 0
  while (start < text.length && spans.length < max) {
    const open = text.indexOf('{', start)
    const openArr = text.indexOf('[', start)
    const first = open < 0 ? openArr : openArr < 0 ? open : Math.min(open, openArr)
    if (first < 0) break
    const stack: string[] = []
    let inString = false
    let escaped = false
    let end = -1
    for (let i = first; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
      else if (ch === '}' || ch === ']') {
        if (stack.pop() !== ch) break // parentesi sbagliata: si riprova dal carattere dopo
        if (!stack.length) {
          end = i
          break
        }
      }
    }
    if (end >= 0) {
      spans.push(text.slice(first, end + 1))
      start = end + 1
    } else {
      start = first + 1
    }
  }
  return spans
}

function parseLoose(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    try {
      // virgole prima di una chiusura: {"a": 1,} / [1, 2,]
      return JSON.parse(json.replace(/,\s*([}\]])/g, '$1'))
    } catch {
      return undefined
    }
  }
}

function normalize(value: unknown): ToolStep | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const step = normalize(item)
      if (step) return step
    }
    return null
  }
  if (!isObject(value)) return null
  const name = [value.tool, value.name, value.tool_name, value.function].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  if (name) {
    const given = [value.args, value.arguments, value.parameters, value.input].find(isObject)
    let args: Record<string, unknown>
    if (given) args = given
    else if (typeof value.arguments === 'string' && isObject(parseLoose(value.arguments))) args = parseLoose(value.arguments) as Record<string, unknown>
    else {
      // argomenti messi accanto a "tool": {"tool": "create_post", "brief": "...", ...}
      args = {}
      for (const [key, v] of Object.entries(value)) {
        if (!['tool', 'name', 'tool_name', 'function', 'reply', 'args', 'arguments', 'parameters', 'input'].includes(key)) args[key] = v
      }
    }
    return { tool: name.trim(), args }
  }
  if (typeof value.reply === 'string') return value as ToolStep
  return null
}

/** Il primo passo valido trovato nella risposta del modello, oppure null. */
export function parseToolStep(raw: string): ToolStep | null {
  const text = raw || ''
  for (const span of balancedSpans(text)) {
    const step = normalize(parseLoose(span))
    if (step) return step
  }
  return null
}

/** La risposta sembra un tentativo di chiamare uno strumento (da non mostrare al cliente). */
export function looksLikeToolCall(raw: string): boolean {
  return /<\/?(function_calls|function_call|tool_call|tool_use|invoke)\b|"tool"\s*:|"tool_name"\s*:|"arguments"\s*:/i.test(raw || '')
}

/** Testo da mostrare in chat senza blocchi di codice, JSON o tag di strumenti. */
export function cleanReplyText(raw: string): string {
  let text = (raw || '').replace(/<(function_calls|function_call|tool_call|tool_use)\b[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/```[\s\S]*?```/g, ' ')
  for (const span of balancedSpans(text)) {
    if (looksLikeToolCall(span) || /^\s*[[{]\s*"/.test(span)) text = text.replace(span, ' ')
  }
  return text
    .replace(/<\/?[a-z_]+>/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Messaggio da aggiungere quando il modello ha sbagliato formato, per fargli rifare il passo. */
export const FORMAT_RETRY = 'Il tuo ultimo messaggio non era nel formato giusto, quindi non è partito nessuno strumento e il cliente non ha visto niente. Rifai il passo rispondendo SOLO con un JSON valido, senza altro testo prima o dopo: {"tool": "nome", "args": {...}} oppure {"reply": "risposta finale"}. Non dire di aver fatto qualcosa finché lo strumento non ha risposto.'

/**
 * Il primo oggetto JSON della risposta che passa il controllo `accept` (es. un documento
 * con "title" e "sections"), anche con testo intorno, blocchi ```json o virgole in piu'.
 */
export function parseJsonObject(raw: string, accept: (value: Record<string, unknown>) => boolean = () => true): Record<string, unknown> | null {
  for (const span of balancedSpans(raw || '', 40)) {
    const value = parseLoose(span)
    if (isObject(value) && accept(value)) return value
  }
  return null
}
