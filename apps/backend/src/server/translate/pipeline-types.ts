import type { GroqCartesiaConfig, ServerEnv } from "#/server/env";
import type {
	TranslateSpeechStreamChunk,
	TranslateSpeechStreamFormat,
} from "@lingo-now/contracts/pipeline-types";
export type {
	TranslateSpeechStreamChunk,
	TranslateSpeechStreamFormat,
} from "@lingo-now/contracts/pipeline-types";

export type PipelineFailure = {
	ok: false;
	status: number;
	message: string;
};

export type TranscribePortInput = {
	audio: File;
	fromLang: string;
	mimeHint: string;
	correlationId: string;
};

export type TranscribePort = (
	input: TranscribePortInput,
) => Promise<{ text: string } | PipelineFailure>;

export type TranslatePortInput = {
	text: string;
	fromLang: string;
	toLang: string;
	correlationId: string;
};

export type TranslatePort = (
	input: TranslatePortInput,
) => Promise<{ translated: string } | PipelineFailure>;

export type SynthesizePortInput = {
	text: string;
	toLang: string;
	correlationId: string;
};

export type SynthesizeStreamResult =
	| PipelineFailure
	| { ok: true; stream: ReadableStream<Uint8Array> };

export type SynthesizePort = (
	input: SynthesizePortInput,
) => Promise<SynthesizeStreamResult>;

export type SpeechTranslatePorts = {
	transcribe: TranscribePort;
	translate: TranslatePort;
	synthesize: SynthesizePort;
};

export type SpeechTranslateInput = {
	audio: File;
	from: string;
	to: string;
	mime: string;
	correlationId?: string;
};

export type RunSpeechTranslatePipelineStreamOptions = {
	fetch?: typeof fetch;
	config?: GroqCartesiaConfig | null;
	serverEnv?: ServerEnv;
	ports?: SpeechTranslatePorts;
	connectWebSocket?: (url: string) => WebSocket;
};
