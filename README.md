# Lingo Now

Browser-based walkie-talkie translation: record speech, run Groq + Cartesia (or echo mode), play the result, and flip languages for the next turn.

## Run locally

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

## Translation

The browser records audio and sends `FormData` with `audio`, `from`, `to`, `mime`, and optional `accessPassword` to a TanStack Start server function. Provider keys stay on the server, and the client receives a typed success or error result instead of parsing a raw HTTP endpoint response.

**Environment validation:** If `TRANSLATE_DEV_ECHO` is not enabled, `GROQ_API_KEY` and `CARTESIA_API_KEY` must be set (non-empty). Built-in Cartesia voices are used for target languages **English**, **Portuguese**, and **Spanish**; for any other target language, fallbackVoiceId is used as the default voice. The first call to `getServerEnv()` throws if the combination is invalid (for example when handling a request). With `**TRANSLATE_DEV_ECHO=1` (or `true`), those keys are optional.

The server function uses one of:

1. `TRANSLATE_DEV_ECHO=1` — Echo the recording back (no APIs) for UI testing.
2. **Groq + Cartesia** — When echo is off, `GROQ_API_KEY` and `CARTESIA_API_KEY` are required. Speech is transcribed (Whisper), translated (Llama), then spoken (Cartesia Sonic). `CARTESIA_VERSION`, `CARTESIA_MODEL_ID`.

For deployed: password is: lingonowluiz

## Scripts

- `pnpm test` — Vitest
- `pnpm lint` / `pnpm format` / `pnpm check` — Biome

## UI components

Add shadcn components with:

```bash
pnpm dlx shadcn@latest add <component>
```

