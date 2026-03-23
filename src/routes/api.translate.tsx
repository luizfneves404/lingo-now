import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/translate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const audio = formData.get('audio')
        const from = formData.get('from')
        const to = formData.get('to')
        const mimeRaw = formData.get('mime')
        const mime =
          typeof mimeRaw === 'string' && mimeRaw.length > 0
            ? mimeRaw
            : 'audio/webm'

        if (!(audio instanceof File) || typeof from !== 'string' || typeof to !== 'string') {
          return new Response(
            JSON.stringify({ error: 'Missing audio file or language codes.' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        const upstream = process.env.TRANSLATE_UPSTREAM_URL
        const devEcho =
          process.env.TRANSLATE_DEV_ECHO === 'true' ||
          process.env.TRANSLATE_DEV_ECHO === '1'

        if (upstream) {
          const forward = new FormData()
          forward.append('audio', audio, audio.name || 'recording.webm')
          forward.append('from', from)
          forward.append('to', to)

          const headers: Record<string, string> = {}
          const key = process.env.TRANSLATE_UPSTREAM_KEY
          if (key) headers.Authorization = `Bearer ${key}`

          const upstreamRes = await fetch(upstream, {
            method: 'POST',
            body: forward,
            headers,
          })

          if (!upstreamRes.ok) {
            const detail = await upstreamRes.text()
            return new Response(
              JSON.stringify({
                error:
                  detail.trim() ||
                  `Translation service returned ${upstreamRes.status}.`,
              }),
              {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }

          const body = await upstreamRes.arrayBuffer()
          const contentType =
            upstreamRes.headers.get('content-type') || 'audio/mpeg'
          return new Response(body, {
            headers: { 'Content-Type': contentType },
          })
        }

        if (devEcho) {
          const body = await audio.arrayBuffer()
          const contentType = mime.split(';')[0]?.trim() || 'audio/webm'
          return new Response(body, {
            headers: { 'Content-Type': contentType },
          })
        }

        return new Response(
          JSON.stringify({
            error:
              'Translation is not configured. Set TRANSLATE_UPSTREAM_URL to your speech-translation HTTP endpoint (multipart: audio, from, to), or set TRANSLATE_DEV_ECHO=1 to echo the recording for local UI testing.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      },
    },
  },
  component: () => null,
})
