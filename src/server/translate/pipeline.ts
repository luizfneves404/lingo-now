import {
	type GroqCartesiaConfig,
	getGroqCartesiaConfig,
	getServerEnv,
} from "#/server/env";
import { logTranslatePerf, perfNowMs } from "#/server/translate/perf-log";
import type {
	RunSpeechTranslatePipelineStreamOptions,
	SpeechTranslateInput,
	SpeechTranslatePorts,
	TranslateSpeechStreamChunk,
} from "#/server/translate/pipeline-types";
import { createGroqCartesiaPorts } from "#/server/translate/providers/groq-cartesia";

export type {
	PipelineFailure,
	RunSpeechTranslatePipelineStreamOptions,
	SpeechTranslateInput,
	SpeechTranslatePorts,
	SynthesizePort,
	SynthesizePortInput,
	SynthesizeStreamResult,
	TranscribePort,
	TranscribePortInput,
	TranslatePort,
	TranslatePortInput,
	TranslateSpeechStreamChunk,
	TranslateSpeechStreamFormat,
} from "#/server/translate/pipeline-types";

function streamErrorFromUnknown(
	e: unknown,
	fallback: string,
): { status: number; message: string } {
	if (e && typeof e === "object" && "status" in e) {
		const st = (e as { status: unknown }).status;
		if (typeof st === "number" && st >= 400 && st < 600) {
			const msg = e instanceof Error ? e.message : fallback;
			return { status: st, message: msg };
		}
	}
	if (e instanceof Error && e.message.trim()) {
		return { status: 502, message: e.message.trim() };
	}
	return { status: 502, message: fallback };
}

export function runSpeechTranslatePipelineStream(
	input: SpeechTranslateInput,
	options?: RunSpeechTranslatePipelineStreamOptions,
): ReadableStream<TranslateSpeechStreamChunk> {
	const pipelineT0 = perfNowMs();

	return new ReadableStream<TranslateSpeechStreamChunk>({
		async start(controller) {
			const fetchImpl = options?.fetch ?? globalThis.fetch;
			let transcribeMs = 0;
			let translateMs = 0;
			let ttsMs = 0;
			let audioChunks = 0;
			let totalPcmBytes = 0;
			let failedStage: string | undefined;
			let ok = false;

			const finishLog = () => {
				logTranslatePerf("pipeline.stream.done", {
					ms: Math.round((perfNowMs() - pipelineT0) * 1000) / 1000,
					transcribeMs,
					translateMs,
					ttsMs,
					audioChunks,
					totalPcmBytes,
					ok,
					failedStage,
				});
			};

			try {
				let ports: SpeechTranslatePorts;
				if (options?.ports) {
					ports = options.ports;
				} else {
					let cfg: GroqCartesiaConfig | null;
					if (options?.config !== undefined) {
						cfg = options.config;
					} else {
						cfg = getGroqCartesiaConfig(options?.serverEnv ?? getServerEnv());
					}
					if (!cfg) {
						controller.enqueue({
							kind: "error",
							status: 503,
							message:
								"Groq and Cartesia are not fully configured (GROQ_API_KEY, CARTESIA_API_KEY).",
						});
						controller.close();
						failedStage = "config";
						finishLog();
						return;
					}
					ports = createGroqCartesiaPorts(cfg, fetchImpl, {
						connectWebSocket: options?.connectWebSocket,
					});
				}

				const correlationId = input.correlationId ?? crypto.randomUUID();

				const tTr0 = perfNowMs();
				const transcribed = await ports.transcribe({
					audio: input.audio,
					fromLang: input.from,
					mimeHint: input.mime,
					correlationId,
				});
				transcribeMs = Math.round((perfNowMs() - tTr0) * 1000) / 1000;
				if ("status" in transcribed) {
					controller.enqueue({
						kind: "error",
						status: transcribed.status,
						message: `Transcribe error: ${transcribed.message}`,
					});
					controller.close();
					failedStage = "transcribe";
					finishLog();
					return;
				}
				const text = transcribed.text.trim();

				if (!text) {
					controller.enqueue({
						kind: "error",
						status: 400,
						message:
							"No speech detected in the recording. Try speaking more clearly.",
					});
					controller.close();
					failedStage = "transcribe";
					finishLog();
					return;
				}

				controller.enqueue({ kind: "transcript", text });

				const tMt0 = perfNowMs();
				const translated = await ports.translate({
					text,
					fromLang: input.from,
					toLang: input.to,
					correlationId,
				});
				translateMs = Math.round((perfNowMs() - tMt0) * 1000) / 1000;
				if ("status" in translated) {
					controller.enqueue({
						kind: "error",
						status: translated.status,
						message: `Translate error: ${translated.message}`,
					});
					controller.close();
					failedStage = "translate";
					finishLog();
					return;
				}

				controller.enqueue({
					kind: "translation",
					text: translated.translated,
				});

				const tTts0 = perfNowMs();
				const synth = await ports.synthesize({
					text: translated.translated,
					toLang: input.to,
					correlationId,
				});
				if (!synth.ok) {
					controller.enqueue({
						kind: "error",
						status: synth.status,
						message: `TTS error: ${synth.message}`,
					});
					controller.close();
					failedStage = "tts";
					finishLog();
					return;
				}

				controller.enqueue({
					kind: "ready",
					format: {
						encoding: "pcm_s16le",
						sampleRate: 44100,
						channels: 1,
					},
				});

				const reader = synth.stream.getReader();
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						audioChunks += 1;
						totalPcmBytes += value.byteLength;
						controller.enqueue({ kind: "audio", pcm: value });
					}
				} catch (e) {
					const { status, message } = streamErrorFromUnknown(
						e,
						"Text-to-speech failed.",
					);
					controller.enqueue({ kind: "error", status, message });
					controller.close();
					failedStage = "tts";
					finishLog();
					return;
				} finally {
					reader.releaseLock();
				}

				ttsMs = Math.round((perfNowMs() - tTts0) * 1000) / 1000;
				controller.enqueue({ kind: "complete" });
				controller.close();
				ok = true;
				finishLog();
			} catch (e) {
				const { status, message } = streamErrorFromUnknown(
					e,
					"Translation pipeline failed.",
				);
				controller.enqueue({ kind: "error", status, message });
				controller.close();
				failedStage = failedStage ?? "unknown";
				finishLog();
			}
		},
	});
}
