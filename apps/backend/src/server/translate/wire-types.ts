import type { TranslateSpeechStreamChunk } from "@lingo-now/contracts/pipeline-types";

export type TranslateSpeechWireChunk =
	| Exclude<TranslateSpeechStreamChunk, { kind: "audio" }>
	| { kind: "audio"; pcmBase64: string };
