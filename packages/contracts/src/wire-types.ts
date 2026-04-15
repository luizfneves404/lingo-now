import type { TranslateSpeechStreamChunk } from "./pipeline-types";

export type TranslateSpeechWireChunk =
	| Exclude<TranslateSpeechStreamChunk, { kind: "audio" }>
	| { kind: "audio"; pcmBase64: string };
