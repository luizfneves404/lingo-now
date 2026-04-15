import type { GroqCartesiaConfig, ServerEnv } from "#/server/env";

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

export type TranslateSpeechStreamFormat = {
	encoding: "pcm_s16le";
	sampleRate: 44100;
	channels: 1;
};

export type TranslateSpeechStreamChunk =
	| { kind: "error"; status: number; message: string }
	| { kind: "transcript"; text: string }
	| { kind: "translation"; text: string }
	| { kind: "ready"; format: TranslateSpeechStreamFormat }
	| { kind: "audio"; pcm: Uint8Array }
	| { kind: "complete" };

export type RunSpeechTranslatePipelineStreamOptions = {
	fetch?: typeof fetch;
	config?: GroqCartesiaConfig | null;
	serverEnv?: ServerEnv;
	ports?: SpeechTranslatePorts;
	connectWebSocket?: (url: string) => WebSocket;
};
