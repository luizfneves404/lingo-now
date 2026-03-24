import { getServerEnv, type ServerEnv } from "#/server/env";
import { translateAccessDeniedMessage } from "#/server/translate/access";
import { logTranslatePerf, perfNowMs } from "#/server/translate/perf-log";
import { runSpeechTranslatePipeline } from "#/server/translate/pipeline";

export type TranslateSpeechSuccess = {
	ok: true;
	audioBase64: string;
	contentType: string;
};

export type TranslateSpeechFailure = {
	ok: false;
	status: number;
	message: string;
};

export type TranslateSpeechResult =
	| TranslateSpeechSuccess
	| TranslateSpeechFailure;

type TranslateSpeechRequestOptions = {
	env?: ServerEnv;
	getEnv?: () => ServerEnv;
	runPipeline?: typeof runSpeechTranslatePipeline;
	correlationId?: string;
};

function coerceAudioFile(value: unknown, mime: string): File | null {
	if (value instanceof File) return value;
	if (value instanceof Blob) {
		return new File([value], "recording", {
			type: value.type || mimeContentType(mime),
		});
	}
	return null;
}

function mimeContentType(mime: string): string {
	return mime.split(";")[0]?.trim() || "audio/webm";
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		const chunk = bytes.subarray(i, i + 0x8000);
		binary += String.fromCharCode(...chunk);
	}
	if (typeof btoa === "function") {
		return btoa(binary);
	}
	return Buffer.from(binary, "binary").toString("base64");
}

function failure(status: number, message: string): TranslateSpeechFailure {
	return { ok: false, status, message };
}

function success(
	body: ArrayBuffer,
	contentType: string,
): TranslateSpeechSuccess {
	return {
		ok: true,
		audioBase64: encodeBase64(new Uint8Array(body)),
		contentType,
	};
}

function normalizeThrownError(error: unknown): TranslateSpeechFailure {
	if (error instanceof Error && error.message.trim()) {
		if (error.message.startsWith("Invalid server environment:")) {
			return failure(500, "Translation service is not configured correctly.");
		}
		return failure(502, error.message.trim());
	}
	return failure(502, "Translation failed.");
}

export async function translateSpeechRequest(
	formData: FormData,
	options: TranslateSpeechRequestOptions = {},
): Promise<TranslateSpeechResult> {
	const correlationId = options.correlationId ?? crypto.randomUUID();
	const requestT0 = perfNowMs();
	try {
		const env = options.env ?? options.getEnv?.() ?? getServerEnv();
		const mimeRaw = formData.get("mime");
		const mime =
			typeof mimeRaw === "string" && mimeRaw.length > 0
				? mimeRaw
				: "audio/webm";
		const audio = coerceAudioFile(formData.get("audio"), mime);
		const fromRaw = formData.get("from");
		const toRaw = formData.get("to");
		const from = typeof fromRaw === "string" ? fromRaw.trim() : "";
		const to = typeof toRaw === "string" ? toRaw.trim() : "";

		logTranslatePerf(correlationId, "request.parsed", {
			msSinceRequestStart:
				Math.round((perfNowMs() - requestT0) * 1000) / 1000,
			mimeLen: mime.length,
			fromLen: from.length,
			toLen: to.length,
			audioBytes: audio?.size ?? 0,
			hasAudio: Boolean(audio),
		});

		if (!audio || !from || !to) {
			logTranslatePerf(correlationId, "request.validation_failed", {
				reason: "missing_fields",
			});
			return failure(400, "Missing audio file or language codes.");
		}

		const deniedMessage = translateAccessDeniedMessage(formData, env);
		if (deniedMessage) {
			logTranslatePerf(correlationId, "request.access_denied", {});
			return failure(401, deniedMessage);
		}

		if (env.TRANSLATE_DEV_ECHO) {
			const readT0 = perfNowMs();
			const buf = await audio.arrayBuffer();
			const readMs = Math.round((perfNowMs() - readT0) * 1000) / 1000;
			logTranslatePerf(correlationId, "request.dev_echo.audio_buffer", {
				ms: readMs,
				audioBytes: buf.byteLength,
			});
			const encT0 = perfNowMs();
			const res = success(buf, mimeContentType(mime));
			logTranslatePerf(correlationId, "request.dev_echo.encoded", {
				ms: Math.round((perfNowMs() - encT0) * 1000) / 1000,
				outputBytes: buf.byteLength,
				audioBase64Chars: res.audioBase64.length,
			});
			logTranslatePerf(correlationId, "request.done", {
				ms: Math.round((perfNowMs() - requestT0) * 1000) / 1000,
				path: "dev_echo",
				ok: true,
			});
			return res;
		}

		const runPipeline = options.runPipeline ?? runSpeechTranslatePipeline;
		const pipeT0 = perfNowMs();
		const pipelineResult = await runPipeline(
			{
				audio,
				from,
				to,
				mime,
			},
			{ correlationId },
		);
		const pipeMs = Math.round((perfNowMs() - pipeT0) * 1000) / 1000;
		logTranslatePerf(correlationId, "request.pipeline_returned", {
			ms: pipeMs,
			ok: pipelineResult.ok,
			status: pipelineResult.ok ? 200 : pipelineResult.status,
			outputBytes: pipelineResult.ok ? pipelineResult.body.byteLength : 0,
		});

		if (!pipelineResult.ok) {
			logTranslatePerf(correlationId, "request.done", {
				ms: Math.round((perfNowMs() - requestT0) * 1000) / 1000,
				path: "pipeline",
				ok: false,
				status: pipelineResult.status,
			});
			return pipelineResult;
		}

		const encT0 = perfNowMs();
		const res = success(
			pipelineResult.body,
			pipelineResult.contentType,
		);
		logTranslatePerf(correlationId, "request.base64_encoded", {
			ms: Math.round((perfNowMs() - encT0) * 1000) / 1000,
			inputBytes: pipelineResult.body.byteLength,
			audioBase64Chars: res.audioBase64.length,
		});
		logTranslatePerf(correlationId, "request.done", {
			ms: Math.round((perfNowMs() - requestT0) * 1000) / 1000,
			path: "pipeline",
			ok: true,
		});
		return res;
	} catch (error) {
		logTranslatePerf(correlationId, "request.error", {
			ms: Math.round((perfNowMs() - requestT0) * 1000) / 1000,
			name: error instanceof Error ? error.name : "unknown",
		});
		return normalizeThrownError(error);
	}
}
