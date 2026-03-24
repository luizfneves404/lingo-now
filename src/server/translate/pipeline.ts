import {
	type GroqCartesiaConfig,
	getGroqCartesiaConfig,
	getServerEnv,
} from "#/server/env";
import { resolveCartesiaVoiceId } from "#/server/translate/voices";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const LLM_MODEL = "llama-3.3-70b-versatile";
const CARTESIA_BYTES_URL = "https://api.cartesia.ai/tts/bytes";

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

function extensionForMime(mime: string): string {
	const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	if (base === "audio/webm") return ".webm";
	if (base === "audio/mp4" || base === "audio/m4a") return ".m4a";
	if (base === "audio/ogg") return ".ogg";
	if (base === "audio/wav" || base === "audio/wave") return ".wav";
	if (base === "audio/mpeg" || base === "audio/mp3") return ".mp3";
	return ".webm";
}

function audioFileForGroq(audio: File, mimeHint: string): File {
	const name = audio.name?.trim();
	if (name && /\.\w{2,4}$/i.test(name)) return audio;
	const ext = extensionForMime(mimeHint || audio.type || "audio/webm");
	return new File([audio], `recording${ext}`, { type: audio.type || mimeHint });
}

async function groqTranscribe(
	fetchImpl: typeof fetch,
	apiKey: string,
	audio: File,
	fromLang: string,
	mimeHint: string,
): Promise<{ text: string } | PipelineFailure> {
	const body = new FormData();
	body.append("model", WHISPER_MODEL);
	body.append("file", audioFileForGroq(audio, mimeHint));
	body.append("language", fromLang);

	const res = await fetchImpl(`${GROQ_BASE}/audio/transcriptions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body,
	});

	if (!res.ok) {
		const detail = await res.text();
		return {
			ok: false,
			status: 502,
			message:
				detail.trim().slice(0, 500) ||
				`Speech recognition failed (${res.status}).`,
		};
	}

	const data = (await res.json()) as { text?: string };
	const text = typeof data.text === "string" ? data.text.trim() : "";
	return { text };
}

async function groqTranslate(
	fetchImpl: typeof fetch,
	apiKey: string,
	text: string,
	fromLang: string,
	toLang: string,
): Promise<{ translated: string } | PipelineFailure> {
	const res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: LLM_MODEL,
			temperature: 0.2,
			messages: [
				{
					role: "system",
					content:
						"You are a translator. Output only the translated text, with no quotes, labels, or explanation.",
				},
				{
					role: "user",
					content: `Translate the following from ISO 639-1 language "${fromLang}" to ISO 639-1 language "${toLang}".\n\n${text}`,
				},
			],
		}),
	});

	if (!res.ok) {
		const detail = await res.text();
		return {
			ok: false,
			status: 502,
			message:
				detail.trim().slice(0, 500) || `Translation failed (${res.status}).`,
		};
	}

	const data = (await res.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
	};
	const raw = data.choices?.[0]?.message?.content;
	const translated = typeof raw === "string" ? raw.trim() : "";
	if (!translated) {
		return {
			ok: false,
			status: 502,
			message: "Translation model returned empty text.",
		};
	}
	return { translated };
}

async function cartesiaTtsBytes(
	fetchImpl: typeof fetch,
	cartesiaApiKey: string,
	transcript: string,
	toLang: string,
	opts: { voiceId: string; version: string; modelId: string },
): Promise<PipelineSuccess | PipelineFailure> {
	const res = await fetchImpl(CARTESIA_BYTES_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${cartesiaApiKey}`,
			"Content-Type": "application/json",
			"Cartesia-Version": opts.version,
		},
		body: JSON.stringify({
			model_id: opts.modelId,
			transcript,
			voice: { mode: "id", id: opts.voiceId },
			language: toLang,
			output_format: {
				container: "wav",
				encoding: "pcm_s16le",
				sample_rate: 44100,
			},
		}),
	});

	if (!res.ok) {
		const detail = await res.text();
		return {
			ok: false,
			status: 502,
			message:
				detail.trim().slice(0, 500) || `Text-to-speech failed (${res.status}).`,
		};
	}

	const body = await res.arrayBuffer();
	const contentType =
		res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/wav";

	return { ok: true, body, contentType };
}

export type SpeechTranslateInput = {
	audio: File;
	from: string;
	to: string;
	mime: string;
};

export type RunSpeechTranslatePipelineOptions = {
	fetch?: typeof fetch;
	config?: GroqCartesiaConfig | null;
};

export async function runSpeechTranslatePipeline(
	input: SpeechTranslateInput,
	options?: RunSpeechTranslatePipelineOptions,
): Promise<PipelineResult> {
	const fetchImpl = options?.fetch ?? globalThis.fetch;
	let cfg: GroqCartesiaConfig | null;
	if (options?.config !== undefined) {
		cfg = options.config;
	} else {
		cfg = getGroqCartesiaConfig(getServerEnv());
	}
	if (!cfg) {
		return {
			ok: false,
			status: 503,
			message:
				"Groq and Cartesia are not fully configured (GROQ_API_KEY, CARTESIA_API_KEY).",
		};
	}

	const transcribed = await groqTranscribe(
		fetchImpl,
		cfg.groqApiKey,
		input.audio,
		input.from,
		input.mime,
	);
	if ("status" in transcribed) return transcribed;
	const { text } = transcribed;

	if (!text) {
		return {
			ok: false,
			status: 400,
			message:
				"No speech detected in the recording. Try speaking more clearly.",
		};
	}

	const translated = await groqTranslate(
		fetchImpl,
		cfg.groqApiKey,
		text,
		input.from,
		input.to,
	);
	if ("status" in translated) return translated;

	const voiceId = resolveCartesiaVoiceId(input.to, cfg.cartesiaFallbackVoiceId);

	return cartesiaTtsBytes(
		fetchImpl,
		cfg.cartesiaApiKey,
		translated.translated,
		input.to,
		{
			voiceId,
			version: cfg.cartesiaVersion,
			modelId: cfg.cartesiaModelId,
		},
	);
}
