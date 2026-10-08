process.env.GEMINI_API_KEY = 'test-key'

async function main() {
  const calls: string[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const model = url.match(/models\/([^:]+):/)?.[1] || '?'
    calls.push(model)

    if (model === 'gemini-3.6-flash') {
      return new Response(
        JSON.stringify({
          error: {
            message:
              'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
            status: 'UNAVAILABLE',
          },
        }),
        { status: 503 }
      )
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: `Ciao dal fallback ${model}` }] },
            finishReason: 'STOP',
          },
        ],
        modelVersion: model,
      }),
      { status: 200 }
    )
  }) as typeof fetch

  const { callGeminiWithFallback } = await import('../lib/gemini')
  const result = await callGeminiWithFallback(
    [{ role: 'user', content: 'Ciao' }],
    'gemini-3.6-flash',
    'sys'
  )

  console.log('result:', result.message, '| model:', result.model)
  console.log('tried:', calls.join(' -> '))

  if (!result.message.includes('fallback')) {
    throw new Error('did not get fallback response')
  }
  if (calls[0] !== 'gemini-3.6-flash') {
    throw new Error('did not try primary first')
  }
  if (calls[1] !== 'gemini-3.5-flash-lite') {
    throw new Error(`did not fall back to 3.5 lite, got ${calls[1]}`)
  }

  globalThis.fetch = originalFetch
  console.log('FALLBACK INTEGRATION OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
