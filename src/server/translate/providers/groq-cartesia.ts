import type { GroqCartesiaConfig } from "#/server/env";
import type {
	PipelineFailure,
	SpeechTranslatePorts,
	SynthesizeStreamResult,
} from "#/server/translate/pipeline-types";
import { openCartesiaPcmStream } from "#/server/translate/providers/cartesia-websocket";
import { resolveCartesiaVoiceId } from "#/server/translate/voices";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const LLM_MODEL = "llama-3.1-8b-instant";

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
	correlationId: string,
): Promise<{ text: string } | PipelineFailure> {
	const body = new FormData();
	body.append("model", WHISPER_MODEL);
	body.append("file", audioFileForGroq(audio, mimeHint));
	body.append("language", fromLang);

	const res = await fetchImpl(`${GROQ_BASE}/audio/transcriptions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"X-Request-ID": correlationId,
		},
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
	correlationId: string,
): Promise<{ translated: string } | PipelineFailure> {
	const payload = {
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
	};
	const jsonBody = JSON.stringify(payload);

	const res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"X-Request-ID": correlationId,
		},
		body: jsonBody,
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

export type GroqCartesiaPortsOptions = {
	connectWebSocket?: (url: string) => WebSocket;
};

export function createGroqCartesiaPorts(
	cfg: GroqCartesiaConfig,
	fetchImpl: typeof fetch,
	opts?: GroqCartesiaPortsOptions,
): SpeechTranslatePorts {
	const groqKey = cfg.groqApiKey;
	const cartesiaKey = cfg.cartesiaApiKey;
	const connectWebSocket =
		opts?.connectWebSocket ??
		((url: string) => new WebSocket(url) as WebSocket);
	return {
		transcribe: (input) =>
			groqTranscribe(
				fetchImpl,
				groqKey,
				input.audio,
				input.fromLang,
				input.mimeHint,
				input.correlationId,
			),
		translate: (input) =>
			groqTranslate(
				fetchImpl,
				groqKey,
				input.text,
				input.fromLang,
				input.toLang,
				input.correlationId,
			),
		synthesize: async (input): Promise<SynthesizeStreamResult> => {
			const voiceId = resolveCartesiaVoiceId(
				input.toLang,
				cfg.cartesiaFallbackVoiceId,
			);
			return openCartesiaPcmStream({
				connectWebSocket,
				apiKey: cartesiaKey,
				cartesiaVersion: cfg.cartesiaVersion,
				generation: {
					modelId: cfg.cartesiaModelId,
					transcript: input.text,
					voiceId,
					language: input.toLang,
					contextId: input.correlationId,
				},
			});
		},
	};
}
