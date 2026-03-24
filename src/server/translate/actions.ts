import { createServerFn } from "@tanstack/react-start";
import { logTranslatePerf, perfNowMs } from "#/server/translate/perf-log";
import { translateSpeechRequest } from "#/server/translate/request";

export const translateSpeech = createServerFn({ method: "POST" })
	.inputValidator((data) => {
		if (!(data instanceof FormData)) {
			throw new Error("Expected FormData");
		}
		return data;
	})
	.handler(async ({ data }) => {
		const correlationId = crypto.randomUUID();
		const t0 = perfNowMs();
		logTranslatePerf(correlationId, "server_fn.start", {});
		const result = await translateSpeechRequest(data, { correlationId });
		logTranslatePerf(correlationId, "server_fn.end", {
			ms: Math.round((perfNowMs() - t0) * 1000) / 1000,
			ok: result.ok,
			status: result.ok ? 200 : result.status,
			responseAudioBase64Chars: result.ok ? result.audioBase64.length : 0,
		});
		return result;
	});
