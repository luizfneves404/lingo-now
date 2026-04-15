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
