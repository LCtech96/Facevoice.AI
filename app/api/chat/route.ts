import { NextRequest, NextResponse } from 'next/server'
import { getDisabledModels } from '@/lib/chat-access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refusalNotice, refusalRetryModel, streamClaude, type ClaudeChatMessage } from '@/lib/claude'
import {
  calculateCostUsd,
  getModelProvider,
  isBilledModel,
  resolveChatModel,
} from '@/lib/chat-models'
import { callGeminiWithFallback, type GeminiChatMessage } from '@/lib/gemini'
import {
  ChatAuthError,
  assertWithinLimit,
  getUsageSummary,
  recordUsage,
  requireChatMember,
} from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'
// Una risposta lunga in streaming supera i 10s di default di Vercel.
export const maxDuration = 300

type Attachment = { mimeType: string; data: string }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BASE_SYSTEM_PROMPT = `Sei l'assistente AI interno di Facevoice.AI, usato dal team per lavorare sui progetti dei clienti.

Rispondi nella lingua dell'utente (di norma italiano). Sii diretto e concreto: niente preamboli, niente riepiloghi di quello che stai per fare. Quando una richiesta è ambigua, fai una sola domanda di chiarimento invece di indovinare. Se non sai una cosa, dillo.

Ogni risposta deve restare entro circa 300 caratteri (poche frasi). Se il compito richiede davvero più spazio, dai la parte più utile ora e chiedi se continuare.`

/** Stesso contesto che riceve Claude, nel formato che vuole Gemini. */
function buildGeminiSystemPrompt(projectInstructions?: string | null): string {
  const instructions = projectInstructions?.trim()
  if (!instructions) return BASE_SYSTEM_PROMPT

  return `${BASE_SYSTEM_PROMPT}

Contesto specifico di questo progetto. Vale per tutta la conversazione:

${instructions}`
}

function errorResponse(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : 'Errore sconosciuto'
  console.error('Chat API error:', message)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireChatMember(req)
    const body = await req.json()
    const content: string = String(body?.content || '').trim()
    const attachments: Attachment[] = Array.isArray(body?.attachments)
      ? body.attachments.filter((a: any) => a?.mimeType && a?.data)
      : []

    if (!content && attachments.length === 0) {
      return NextResponse.json({ error: 'Messaggio vuoto.' }, { status: 400 })
    }

    const model = resolveChatModel(body?.model)
    const provider = getModelProvider(model)

    // Modelli disattivati dall'admin per questo utente.
    if ((await getDisabledModels(member.user_id)).includes(model)) {
      return NextResponse.json({ error: 'Questo modello non è abilitato per il tuo account. Scegline un altro.' }, { status: 403 })
    }

    // Gemini gira sulla chiave gratuita: non intacca il budget, quindi
    // resta usabile anche a tetto Claude esaurito.
    if (isBilledModel(model)) {
      await assertWithinLimit(member)
    }

    // Un id che non e' un UUID non puo' corrispondere a nessuna riga:
    // e' una bozza lato client (o un client vecchio ancora in cache),
    // quindi vale come "chat nuova", non come chat mancante.
    const requestedChatId = body?.chatId ? String(body.chatId) : null
    let chatId: string | null =
      requestedChatId && UUID_PATTERN.test(requestedChatId) ? requestedChatId : null

    // --- Chat: esistente (e di questo utente) oppure nuova ------------
    let projectId: string | null = body?.projectId ? String(body.projectId) : null

    if (chatId) {
      const { data: chat, error } = await supabaseAdmin
        .from('user_chats')
        .select('id, user_id, project_id')
        .eq('id', chatId)
        .maybeSingle()

      if (error || !chat || chat.user_id !== member.user_id) {
        return NextResponse.json({ error: 'Chat non trovata.' }, { status: 404 })
      }
      projectId = chat.project_id
    } else {
      const title = (content || 'Nuova chat').slice(0, 60)
      const { data: created, error } = await supabaseAdmin
        .from('user_chats')
        .insert({ user_id: member.user_id, project_id: projectId, title, model })
        .select('id')
        .single()

      if (error || !created) {
        return NextResponse.json({ error: 'Impossibile creare la chat.' }, { status: 500 })
      }
      chatId = created.id
    }

    // --- Istruzioni del progetto -------------------------------------
    let projectInstructions: string | null = null
    if (projectId) {
      const { data: project } = await supabaseAdmin
        .from('chat_projects')
        .select('system_instructions, user_id')
        .eq('id', projectId)
        .maybeSingle()

      if (project?.user_id === member.user_id) {
        projectInstructions = project.system_instructions
      }
    }

    // --- Storico dal database, non dal client ------------------------
    const { data: history } = await supabaseAdmin
      .from('user_chat_messages')
      .select('role, content, attachments')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })

    const { data: savedUserMessage, error: insertError } = await supabaseAdmin
      .from('user_chat_messages')
      .insert({
        chat_id: chatId,
        user_id: member.user_id,
        role: 'user',
        content,
        attachments: attachments.length ? attachments : null,
      })
      .select('id, created_at')
      .single()

    if (insertError || !savedUserMessage) {
      return NextResponse.json({ error: 'Impossibile salvare il messaggio.' }, { status: 500 })
    }

    const conversation: ClaudeChatMessage[] = [
      ...((history || []) as ClaudeChatMessage[]),
      { role: 'user', content, attachments },
    ]

    // --- Risposta in streaming (NDJSON) -------------------------------
    // Ogni riga e' un evento JSON: 'chat' (id definitivo), 'delta'
    // (testo), 'done' (messaggio salvato + consumo), 'error'.
    const finalChatId = chatId
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }

        let fullText = ''

        try {
          send({
            type: 'chat',
            chatId: finalChatId,
            userMessageId: savedUserMessage.id,
          })

          let refused = false
          let servedModel = model
          /** Modello a cui si addebita la risposta: quello scelto, o la riserva dopo un rifiuto. */
          let billedModel = model
          let usageTotals = {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          }

          if (provider === 'google') {
            // Gemini non ha streaming in questo wrapper: la risposta
            // arriva intera e viene inviata come un unico delta, cosi'
            // il protocollo resta lo stesso per entrambi i provider.
            const geminiMessages: GeminiChatMessage[] = conversation.map((msg) => ({
              role: msg.role,
              content: msg.content,
              attachments: msg.attachments ?? undefined,
            }))

            const result = await callGeminiWithFallback(
              geminiMessages,
              model,
              buildGeminiSystemPrompt(projectInstructions)
            )

            fullText = result.message
            servedModel = result.model
            usageTotals = {
              input_tokens: result.usage?.prompt_tokens ?? 0,
              output_tokens: result.usage?.completion_tokens ?? 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            }

            send({ type: 'delta', text: fullText })
          } else {
            // Il testo arriva solo dai blocchi "text": i blocchi "thinking" di Haiku 5.5 non si mostrano.
            const runClaude = async (retryAfterRefusal: boolean) => {
              const claudeStream = streamClaude(conversation, model, projectInstructions, {
                retryAfterRefusal,
              })

              for await (const event of claudeStream) {
                if (
                  event.type === 'content_block_delta' &&
                  event.delta.type === 'text_delta'
                ) {
                  fullText += event.delta.text
                  send({ type: 'delta', text: event.delta.text })
                }
              }

              return claudeStream.finalMessage()
            }
            const usageOf = (message: Awaited<ReturnType<typeof runClaude>>) => ({
              input_tokens: message.usage.input_tokens ?? 0,
              output_tokens: message.usage.output_tokens ?? 0,
              cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
            })

            let finalMessage = await runClaude(false)
            const retryModel = refusalRetryModel(model)
            if (finalMessage.stop_reason === 'refusal' && retryModel) {
              // Haiku 5.5 non ha una riserva lato server: la chiamata rifiutata si registra
              // (si paga) e la stessa richiesta si rifa' una volta con Haiku 4.5. Nei log
              // solo la categoria del rifiuto, mai il testo.
              console.warn(
                `Chat: ${finalMessage.model} ha rifiutato la richiesta (categoria: ${finalMessage.stop_details?.category ?? 'non indicata'}), la rifaccio con ${retryModel}`
              )
              const refusedUsage = usageOf(finalMessage)
              await recordUsage({
                userId: member.user_id,
                chatId: finalChatId,
                model,
                usage: refusedUsage,
                costUsd: calculateCostUsd(model, refusedUsage),
              })
              // Il testo parziale della risposta rifiutata non vale: conta quello della riprova.
              fullText = ''
              billedModel = retryModel
              finalMessage = await runClaude(true)
            }
            refused = finalMessage.stop_reason === 'refusal'
            servedModel = finalMessage.model
            usageTotals = usageOf(finalMessage)
          }

          const content = refused ? refusalNotice() : fullText.trim()

          const { data: savedAssistantMessage } = await supabaseAdmin
            .from('user_chat_messages')
            .insert({
              chat_id: finalChatId,
              user_id: member.user_id,
              role: 'assistant',
              content,
            })
            .select('id, created_at')
            .single()

          // Prezzo del modello che ha risposto davvero (Haiku 4.5 dopo un rifiuto di Haiku 5.5).
          const costUsd = calculateCostUsd(billedModel, usageTotals)
          await recordUsage({
            userId: member.user_id,
            chatId: finalChatId,
            model: billedModel,
            usage: usageTotals,
            costUsd,
          })

          await supabaseAdmin
            .from('user_chats')
            .update({ model, updated_at: new Date().toISOString() })
            .eq('id', finalChatId)

          const usage = await getUsageSummary(member)

          send({
            type: 'done',
            message: {
              id: savedAssistantMessage?.id,
              role: 'assistant',
              content,
              timestamp: savedAssistantMessage?.created_at,
            },
            model: servedModel,
            refused,
            usage: {
              costUsd,
              spentUsd: usage.spentUsd,
              limitUsd: usage.limitUsd,
              remainingUsd: usage.remainingUsd,
            },
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Errore durante la risposta'
          console.error('Chat stream error:', message)

          // Se qualcosa era gia' arrivato, salvalo: meglio una risposta
          // troncata di una conversazione con un buco.
          if (fullText.trim()) {
            await supabaseAdmin.from('user_chat_messages').insert({
              chat_id: finalChatId,
              user_id: member.user_id,
              role: 'assistant',
              content: fullText.trim(),
            })
          }

          send({ type: 'error', error: message })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
