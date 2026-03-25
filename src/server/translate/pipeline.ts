import {
	type GroqCartesiaConfig,
	getGroqCartesiaConfig,
	getServerEnv,
} from "#/server/env";
import { logTranslatePerf, perfNowMs } from "#/server/translate/perf-log";
import type {
	PipelineResult,
	RunSpeechTranslatePipelineOptions,
	SpeechTranslateInput,
	SpeechTranslatePorts,
} from "#/server/translate/pipeline-types";
import { createGroqCartesiaPorts } from "#/server/translate/providers/groq-cartesia";

export type {
	PipelineFailure,
	PipelineResult,
	PipelineSuccess,
	RunSpeechTranslatePipelineOptions,
	SpeechTranslateInput,
	SpeechTranslatePorts,
	SynthesizePort,
	SynthesizePortInput,
	TranscribePort,
	TranscribePortInput,
	TranslatePort,
	TranslatePortInput,
} from "#/server/translate/pipeline-types";

export async function runSpeechTranslatePipeline(
	input: SpeechTranslateInput,
	options?: RunSpeechTranslatePipelineOptions,
): Promise<PipelineResult> {
	const correlationId = options?.correlationId ?? crypto.randomUUID();
	const pipelineT0 = perfNowMs();
	const fetchImpl = options?.fetch ?? globalThis.fetch;

	let ports: SpeechTranslatePorts;
	if (options?.ports) {
		ports = options.ports;
	} else {
		let cfg: GroqCartesiaConfig | null;
		if (options?.config !== undefined) {
			cfg = options.config;
		} else {
			cfg = getGroqCartesiaConfig(getServerEnv());
		}
		if (!cfg) {
			logTranslatePerf(correlationId, "pipeline.config_missing", {});
			return {
				ok: false,
				status: 503,
				message:
					"Groq and Cartesia are not fully configured (GROQ_API_KEY, CARTESIA_API_KEY).",
			};
		}
		ports = createGroqCartesiaPorts(cfg, fetchImpl);
	}

	logTranslatePerf(correlationId, "pipeline.start", {
		audioBytes: input.audio.size,
		fromLen: input.from.length,
		toLen: input.to.length,
		mimeLen: input.mime.length,
	});

	const transcribed = await ports.transcribe({
		audio: input.audio,
		fromLang: input.from,
		mimeHint: input.mime,
		correlationId,
	});
	if ("status" in transcribed) {
		logTranslatePerf(correlationId, "pipeline.end", {
			ms: Math.round((perfNowMs() - pipelineT0) * 1000) / 1000,
			ok: false,
			failedStage: "transcribe",
		});
		return transcribed;
	}
	const text = transcribed.text.trim();

	if (!text) {
		logTranslatePerf(correlationId, "pipeline.no_speech_text", {
			ms: Math.round((perfNowMs() - pipelineT0) * 1000) / 1000,
		});
		return {
			ok: false,
			status: 400,
			message:
				"No speech detected in the recording. Try speaking more clearly.",
		};
	}

	const translated = await ports.translate({
		text,
		fromLang: input.from,
		toLang: input.to,
		correlationId,
	});
	if ("status" in translated) {
		logTranslatePerf(correlationId, "pipeline.end", {
			ms: Math.round((perfNowMs() - pipelineT0) * 1000) / 1000,
			ok: false,
			failedStage: "translate",
		});
		return translated;
	}

	const ttsResult = await ports.synthesize({
		text: translated.translated,
		toLang: input.to,
		correlationId,
	});
	logTranslatePerf(correlationId, "pipeline.end", {
		ms: Math.round((perfNowMs() - pipelineT0) * 1000) / 1000,
		ok: ttsResult.ok,
		failedStage: ttsResult.ok ? undefined : "tts",
		audioOutBytes: ttsResult.ok ? ttsResult.body.byteLength : 0,
	});
	return ttsResult;
}
