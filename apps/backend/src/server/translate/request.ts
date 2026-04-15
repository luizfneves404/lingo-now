import { getServerEnv, type ServerEnv } from "#/server/env";
import { translateAccessDeniedMessage } from "#/server/translate/access";
import { logTranslatePerf, perfNowMs } from "#/server/translate/perf-log";
import {
	runSpeechTranslatePipelineStream,
	type TranslateSpeechStreamChunk,
} from "#/server/translate/pipeline";

export type { TranslateSpeechStreamChunk } from "#/server/translate/pipeline-types";

type TranslateSpeechStreamRequestOptions = {
	env?: ServerEnv;
	getEnv?: () => ServerEnv;
	runPipelineStream?: typeof runSpeechTranslatePipelineStream;
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

function devEchoPcmChunks(): Uint8Array[] {
	const sampleRate = 44100;
	const duration = 0.2;
	const n = Math.floor(sampleRate * duration);
	const buf = new Int16Array(n);
	const freq = 440;
	for (let i = 0; i < n; i++) {
		buf[i] = Math.round(Math.sin(2 * Math.PI * freq * (i / sampleRate)) * 3000);
	}
	const pcm = new Uint8Array(buf.buffer);
	const mid = Math.ceil(pcm.length / 2);
	if (pcm.length === 0) {
		return [pcm];
	}
	if (mid >= pcm.length) {
		return [pcm];
	}
	return [pcm.subarray(0, mid), pcm.subarray(mid)];
}

function normalizeThrownError(
	status: number,
	message: string,
): TranslateSpeechStreamChunk {
	return { kind: "error", status, message };
}

function parseTranslateDevEchoOverride(
	value: FormDataEntryValue | null,
): boolean | null {
	if (typeof value !== "string") return null;
	if (value === "1" || value === "true") return true;
	if (value === "0" || value === "false") return false;
	return null;
}

export function translateSpeechRequest(
	formData: FormData,
	options: TranslateSpeechStreamRequestOptions = {},
): ReadableStream<TranslateSpeechStreamChunk> {
	const requestT0 = perfNowMs();

	return new ReadableStream<TranslateSpeechStreamChunk>({
		async start(controller) {
			let path = "unknown";
			let ok = false;
			let status = 200;
			let errorMessage: string | undefined;

			const finishLog = () => {
				logTranslatePerf("request.done", {
					ms: Math.round((perfNowMs() - requestT0) * 1000) / 1000,
					path,
					ok,
					status,
					message: errorMessage,
				});
			};

			try {
				const env = options.env ?? options.getEnv?.() ?? getServerEnv();
				const translateDevEchoOverride = parseTranslateDevEchoOverride(
					formData.get("translateDevEcho"),
				);
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
					path = "validation";
					status = 400;
					errorMessage = "Missing audio file or language codes.";
					controller.enqueue({
						kind: "error",
						status: 400,
						message: errorMessage,
					});
					controller.close();
					finishLog();
					return;
				}

				const deniedMessage = translateAccessDeniedMessage(formData, env);
				if (deniedMessage) {
					path = "access_denied";
					status = 401;
					errorMessage = deniedMessage;
					controller.enqueue({
						kind: "error",
						status: 401,
						message: deniedMessage,
					});
					controller.close();
					finishLog();
					return;
				}

				if (translateDevEchoOverride ?? env.TRANSLATE_DEV_ECHO) {
					path = "dev_echo";
					const chunks = devEchoPcmChunks();
					controller.enqueue({ kind: "transcript", text: "[dev echo]" });
					controller.enqueue({ kind: "translation", text: "[dev echo]" });
					controller.enqueue({
						kind: "ready",
						format: {
							encoding: "pcm_s16le",
							sampleRate: 44100,
							channels: 1,
						},
					});
					for (const pcm of chunks) {
						controller.enqueue({ kind: "audio", pcm });
					}
					controller.enqueue({ kind: "complete" });
					controller.close();
					ok = true;
					status = 200;
					finishLog();
					return;
				}

				path = "pipeline";
				const runStream =
					options.runPipelineStream ?? runSpeechTranslatePipelineStream;
				const pipelineStream = runStream(
					{
						audio,
						from,
						to,
						mime,
					},
					{ serverEnv: env },
				);

				const reader = pipelineStream.getReader();
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						controller.enqueue(value);
					}
				} catch (streamErr) {
					const message =
						streamErr instanceof Error && streamErr.message.trim()
							? streamErr.message.trim()
							: "Translation stream failed.";
					controller.enqueue({
						kind: "error",
						status: 502,
						message,
					});
				} finally {
					reader.releaseLock();
				}

				controller.close();
			} catch (error) {
				path = "error";
				ok = false;
				if (error instanceof Error && error.message.trim()) {
					if (error.message.startsWith("Invalid server environment:")) {
						status = 500;
						errorMessage = "Translation service is not configured correctly.";
					} else {
						status = 502;
						errorMessage = error.message.trim();
					}
				} else {
					status = 502;
					errorMessage = "Translation failed.";
				}
				controller.enqueue(
					normalizeThrownError(status, errorMessage ?? "Translation failed."),
				);
				controller.close();
				finishLog();
			}
		},
	});
}
