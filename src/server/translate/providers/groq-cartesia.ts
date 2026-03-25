import type { GroqCartesiaConfig } from "#/server/env";
import {
	logTranslatePerf,
	perfNowMs,
	utf8ByteLength,
} from "#/server/translate/perf-log";
import type {
	PipelineFailure,
	PipelineResult,
	PipelineSuccess,
	SpeechTranslatePorts,
} from "#/server/translate/pipeline-types";
import { resolveCartesiaVoiceId } from "#/server/translate/voices";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const WHISPER_MODEL = "whisper-large-v3-turbo";
const LLM_MODEL = "llama-3.1-8b-instant";
const CARTESIA_BYTES_URL = "https://api.cartesia.ai/tts/bytes";

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

	logTranslatePerf(correlationId, "pipeline.transcribe.start", {
		audioBytes: audio.size,
		fromLangLen: fromLang.length,
		mimeHintLen: mimeHint.length,
	});

	const t0 = perfNowMs();
	const res = await fetchImpl(`${GROQ_BASE}/audio/transcriptions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body,
	});

	if (!res.ok) {
		const detail = await res.text();
		logTranslatePerf(correlationId, "pipeline.transcribe.error", {
			ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
			httpStatus: res.status,
			errorBodyChars: detail.length,
			errorBodyUtf8Bytes: utf8ByteLength(detail),
		});
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
	logTranslatePerf(correlationId, "pipeline.transcribe.done", {
		ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
		httpStatus: res.status,
		transcriptChars: text.length,
		transcriptUtf8Bytes: utf8ByteLength(text),
	});
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
	logTranslatePerf(correlationId, "pipeline.translate.start", {
		sourceTextChars: text.length,
		sourceTextUtf8Bytes: utf8ByteLength(text),
		requestJsonChars: jsonBody.length,
		requestJsonUtf8Bytes: utf8ByteLength(jsonBody),
		fromLen: fromLang.length,
		toLen: toLang.length,
	});

	const t0 = perfNowMs();
	const res = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: jsonBody,
	});

	if (!res.ok) {
		const detail = await res.text();
		logTranslatePerf(correlationId, "pipeline.translate.error", {
			ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
			httpStatus: res.status,
			errorBodyChars: detail.length,
			errorBodyUtf8Bytes: utf8ByteLength(detail),
		});
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
		logTranslatePerf(correlationId, "pipeline.translate.empty_output", {
			ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
			httpStatus: res.status,
		});
		return {
			ok: false,
			status: 502,
			message: "Translation model returned empty text.",
		};
	}
	logTranslatePerf(correlationId, "pipeline.translate.done", {
		ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
		httpStatus: res.status,
		translatedChars: translated.length,
		translatedUtf8Bytes: utf8ByteLength(translated),
	});
	return { translated };
}

async function cartesiaTtsBytes(
	fetchImpl: typeof fetch,
	cartesiaApiKey: string,
	transcript: string,
	toLang: string,
	opts: { voiceId: string; version: string; modelId: string },
	correlationId: string,
): Promise<PipelineSuccess | PipelineFailure> {
	const jsonBody = JSON.stringify({
		model_id: opts.modelId,
		transcript,
		voice: { mode: "id", id: opts.voiceId },
		language: toLang,
		output_format: {
			container: "wav",
			encoding: "pcm_s16le",
			sample_rate: 44100,
		},
	});
	logTranslatePerf(correlationId, "pipeline.tts.start", {
		transcriptChars: transcript.length,
		transcriptUtf8Bytes: utf8ByteLength(transcript),
		requestJsonChars: jsonBody.length,
		requestJsonUtf8Bytes: utf8ByteLength(jsonBody),
		toLangLen: toLang.length,
		voiceIdLen: opts.voiceId.length,
		cartesiaVersionLen: opts.version.length,
		modelIdLen: opts.modelId.length,
	});

	const t0 = perfNowMs();
	const res = await fetchImpl(CARTESIA_BYTES_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${cartesiaApiKey}`,
			"Content-Type": "application/json",
			"Cartesia-Version": opts.version,
		},
		body: jsonBody,
	});

	if (!res.ok) {
		const detail = await res.text();
		logTranslatePerf(correlationId, "pipeline.tts.error", {
			ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
			httpStatus: res.status,
			errorBodyChars: detail.length,
			errorBodyUtf8Bytes: utf8ByteLength(detail),
		});
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

	logTranslatePerf(correlationId, "pipeline.tts.done", {
		ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
		httpStatus: res.status,
		audioOutBytes: body.byteLength,
		contentTypeLen: contentType.length,
	});
	return { ok: true, body, contentType };
}

export function createGroqCartesiaPorts(
	cfg: GroqCartesiaConfig,
	fetchImpl: typeof fetch,
): SpeechTranslatePorts {
	const groqKey = cfg.groqApiKey;
	const cartesiaKey = cfg.cartesiaApiKey;
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
		synthesize: async (input): Promise<PipelineResult> => {
			const voiceId = resolveCartesiaVoiceId(
				input.toLang,
				cfg.cartesiaFallbackVoiceId,
			);
			return cartesiaTtsBytes(
				fetchImpl,
				cartesiaKey,
				input.text,
				input.toLang,
				{
					voiceId,
					version: cfg.cartesiaVersion,
					modelId: cfg.cartesiaModelId,
				},
				input.correlationId,
			);
		},
	};
}
