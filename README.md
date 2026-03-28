# Lingo Now

live at https://lingo-now.luizfneves.workers.dev!

Talk across languages at the speed of light.

Powered by Groq and Cartesia, Lingo Now uses a smart pipeline optimized for real-time audio to audio translation. Languages flip automatically after speaking, so you can have a full conversation with someone else, each speaking in their own language.

## How it works

1. Record audio using the browser's microphone
2. Send audio to a Tanstack server function (running on Cloudflare workers)
3. Transcribe the audio to text (using Groq's Whisper v3 turbo)
4. Translate the text to the target language (using Groq's Llama 3.1 8b instant. I could have used a dedicated translation API, but didn't bother integrating another service)
5. Synthesize the translated text to audio (using Cartesia's Sonic v3)
6. Send the audio to the browser to play, streaming back from the server function so that the user can hear the translation as it arrives

## Run locally

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

For the deployed demo, the access password is: lingonowluiz

## Scripts

- `pnpm test` — Vitest (unit tests under `src/`)
- `pnpm test:e2e` — Playwright browser test against real Groq + Cartesia (not part of `pnpm test`). Requires `GROQ_API_KEY`, `CARTESIA_API_KEY`, optional `TRANSLATE_ACCESS_PASSWORD`, and once: `pnpm exec playwright install chromium`. Fake microphone audio: `e2e/fixtures/I_have_friends.wav`.
- `pnpm test:e2e:ui` — Playwright UI mode
- `pnpm lint` / `pnpm format` / `pnpm check` — Biome

## UI components

Add shadcn components with:

```bash
pnpm dlx shadcn@latest add <component>
```

# Tech stack

- React
- Vite
- Shadcn
- Tanstack Start
- Cloudflare Workers
- Playwright
