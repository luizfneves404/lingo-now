import type { TranslateSpeechStreamChunk } from "#/server/translate/pipeline-types";

export type TranslateSpeechWireChunk =
	| Exclude<TranslateSpeechStreamChunk, { kind: "audio" }>
	| { kind: "audio"; pcmBase64: string };
