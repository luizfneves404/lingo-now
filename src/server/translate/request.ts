import { getServerEnv, type ServerEnv } from "#/server/env";
import { translateAccessDeniedMessage } from "#/server/translate/access";
import {
	type PipelineResult,
	runSpeechTranslatePipeline,
} from "#/server/translate/pipeline";

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

function pipelineResultToResponse(
	result: PipelineResult,
): TranslateSpeechResult {
	if (!result.ok) {
		return failure(result.status, result.message);
	}
	return success(result.body, result.contentType);
}

export async function translateSpeechRequest(
	formData: FormData,
	options: TranslateSpeechRequestOptions = {},
): Promise<TranslateSpeechResult> {
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

		if (!audio || !from || !to) {
			return failure(400, "Missing audio file or language codes.");
		}

		const deniedMessage = translateAccessDeniedMessage(formData, env);
		if (deniedMessage) {
			return failure(401, deniedMessage);
		}

		if (env.TRANSLATE_DEV_ECHO) {
			return success(await audio.arrayBuffer(), mimeContentType(mime));
		}

		const runPipeline = options.runPipeline ?? runSpeechTranslatePipeline;
		return pipelineResultToResponse(
			await runPipeline({
				audio,
				from,
				to,
				mime,
			}),
		);
	} catch (error) {
		return normalizeThrownError(error);
	}
}
