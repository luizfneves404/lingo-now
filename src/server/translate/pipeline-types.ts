import type { GroqCartesiaConfig } from "#/server/env";

export type PipelineSuccess = {
	ok: true;
	body: ArrayBuffer;
	contentType: string;
};

export type PipelineFailure = {
	ok: false;
	status: number;
	message: string;
};

export type PipelineResult = PipelineSuccess | PipelineFailure;

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

export type SynthesizePort = (
	input: SynthesizePortInput,
) => Promise<PipelineResult>;

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
};

export type RunSpeechTranslatePipelineOptions = {
	fetch?: typeof fetch;
	config?: GroqCartesiaConfig | null;
	correlationId?: string;
	ports?: SpeechTranslatePorts;
};
