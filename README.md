# Lingo Now

Browser-based walkie-talkie translation: record speech, send it to your translation API, play the result, and flip languages for the next turn.

## Run locally

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

## Translation API

`POST /api/translate` accepts multipart fields: `audio`, `from`, `to`, `mime`.

- **`TRANSLATE_UPSTREAM_URL`** — URL of your speech-translation service (same field names). Optional **`TRANSLATE_UPSTREAM_KEY`** for `Authorization: Bearer …`.
- **`TRANSLATE_DEV_ECHO=1`** — Echo the recording back (no real translation) for UI testing.

## Scripts

- `pnpm test` — Vitest
- `pnpm lint` / `pnpm format` / `pnpm check` — Biome

## UI components

Add shadcn components with:

```bash
pnpm dlx shadcn@latest add <component>
```
