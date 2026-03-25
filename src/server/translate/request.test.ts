import { describe, expect, it, vi } from "vitest";
import { serverEnvSchema } from "#/server/env";
import type { TranslateSpeechStreamChunk } from "#/server/translate/pipeline-types";
import { translateSpeechRequest } from "#/server/translate/request";

function makeAudioFormData() {
	const formData = new FormData();
	formData.set(
		"audio",
		new File([new Uint8Array([1, 2, 3])], "recording.webm", {
			type: "audio/webm",
		}),
	);
	formData.set("from", "en");
	formData.set("to", "es");
	formData.set("mime", "audio/webm");
	return formData;
}

async function readAllChunks(
	stream: ReadableStream<TranslateSpeechStreamChunk>,
): Promise<TranslateSpeechStreamChunk[]> {
	const reader = stream.getReader();
	const out: TranslateSpeechStreamChunk[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		out.push(value);
	}
	return out;
}

describe("translateSpeechRequest", () => {
	it("returns 400 when audio or language codes are missing", async () => {
		const chunks = await readAllChunks(
			translateSpeechRequest(new FormData(), {
				env: serverEnvSchema.parse({
					TRANSLATE_DEV_ECHO: "1",
				}),
			}),
		);

		expect(chunks).toEqual([
			{
				kind: "error",
				status: 400,
				message: "Missing audio file or language codes.",
			},
		]);
	});

	it("returns 400 when language codes are blank", async () => {
		const formData = makeAudioFormData();
		formData.set("from", "  ");

		const chunks = await readAllChunks(
			translateSpeechRequest(formData, {
				env: serverEnvSchema.parse({
					TRANSLATE_DEV_ECHO: "1",
				}),
			}),
		);

		expect(chunks).toEqual([
			{
				kind: "error",
				status: 400,
				message: "Missing audio file or language codes.",
			},
		]);
	});

	it("returns 401 when the access password is invalid", async () => {
		const formData = makeAudioFormData();
		formData.set("accessPassword", "wrong");

		const chunks = await readAllChunks(
			translateSpeechRequest(formData, {
				env: serverEnvSchema.parse({
					TRANSLATE_DEV_ECHO: "1",
					TRANSLATE_ACCESS_PASSWORD: "secret",
				}),
			}),
		);

		expect(chunks).toEqual([
			{
				kind: "error",
				status: 401,
				message: "Invalid or missing access password.",
			},
		]);
	});

	it("returns 401 when the access password is missing", async () => {
		const chunks = await readAllChunks(
			translateSpeechRequest(makeAudioFormData(), {
				env: serverEnvSchema.parse({
					TRANSLATE_DEV_ECHO: "1",
					TRANSLATE_ACCESS_PASSWORD: "secret",
				}),
			}),
		);

		expect(chunks).toEqual([
			{
				kind: "error",
				status: 401,
				message: "Invalid or missing access password.",
			},
		]);
	});

	it("streams dev-echo PCM in dev echo mode", async () => {
		const formData = makeAudioFormData();

		const chunks = await readAllChunks(
			translateSpeechRequest(formData, {
				env: serverEnvSchema.parse({
					TRANSLATE_DEV_ECHO: "1",
				}),
			}),
		);

		expect(chunks[0]).toEqual({
			kind: "transcript",
			text: "[dev echo]",
		});
		expect(chunks[1]).toEqual({
			kind: "translation",
			text: "[dev echo]",
		});
		expect(chunks[2]).toMatchObject({
			kind: "ready",
			format: {
				encoding: "pcm_s16le",
				sampleRate: 44100,
				channels: 1,
			},
		});
		const audioParts = chunks.filter(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "audio" }> =>
				c.kind === "audio",
		);
		expect(audioParts.length).toBeGreaterThanOrEqual(1);
		let total = 0;
		for (const p of audioParts) {
			total += p.pcm.byteLength;
		}
		expect(total).toBe(Math.floor(44100 * 0.2) * 2);
		expect(chunks[chunks.length - 1]).toEqual({ kind: "complete" });
	});

	it("passes pipeline failures through as stream error chunks", async () => {
		const formData = makeAudioFormData();
		const runPipelineStream = vi.fn(
			(): ReadableStream<TranslateSpeechStreamChunk> =>
				new ReadableStream({
					start(controller) {
						controller.enqueue({
							kind: "error",
							status: 502,
							message: "upstream failed",
						});
						controller.close();
					},
				}),
		);

		const chunks = await readAllChunks(
			translateSpeechRequest(formData, {
				env: serverEnvSchema.parse({
					GROQ_API_KEY: "groq",
					CARTESIA_API_KEY: "cartesia",
				}),
				runPipelineStream,
			}),
		);

		expect(chunks).toEqual([
			{ kind: "error", status: 502, message: "upstream failed" },
		]);
		expect(runPipelineStream).toHaveBeenCalledOnce();
	});

	it("forwards successful pipeline audio stream chunks", async () => {
		const runPipelineStream = vi.fn(
			(): ReadableStream<TranslateSpeechStreamChunk> =>
				new ReadableStream({
					start(controller) {
						controller.enqueue({ kind: "transcript", text: "hi" });
						controller.enqueue({ kind: "translation", text: "hola" });
						controller.enqueue({
							kind: "ready",
							format: {
								encoding: "pcm_s16le",
								sampleRate: 44100,
								channels: 1,
							},
						});
						controller.enqueue({
							kind: "audio",
							pcm: new Uint8Array([4, 0, 5, 0, 6, 0]),
						});
						controller.enqueue({ kind: "complete" });
						controller.close();
					},
				}),
		);

		const chunks = await readAllChunks(
			translateSpeechRequest(makeAudioFormData(), {
				env: serverEnvSchema.parse({
					GROQ_API_KEY: "groq",
					CARTESIA_API_KEY: "cartesia",
				}),
				runPipelineStream,
			}),
		);

		expect(chunks.map((c) => c.kind)).toEqual([
			"transcript",
			"translation",
			"ready",
			"audio",
			"complete",
		]);
		const audio = chunks.find(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "audio" }> =>
				c.kind === "audio",
		);
		expect(audio?.pcm).toEqual(new Uint8Array([4, 0, 5, 0, 6, 0]));
	});

	it("normalizes thrown runtime errors from pipeline into stream errors", async () => {
		const formData = makeAudioFormData();

		const runPipelineStream = vi.fn(
			(): ReadableStream<TranslateSpeechStreamChunk> => {
				return new ReadableStream({
					start() {
						throw new Error("fetch failed");
					},
				});
			},
		);

		const chunks = await readAllChunks(
			translateSpeechRequest(formData, {
				env: serverEnvSchema.parse({
					GROQ_API_KEY: "groq",
					CARTESIA_API_KEY: "cartesia",
				}),
				runPipelineStream,
			}),
		);

		expect(chunks).toEqual([
			{ kind: "error", status: 502, message: "fetch failed" },
		]);
	});

	it("returns a stable message when server env parsing throws", async () => {
		const chunks = await readAllChunks(
			translateSpeechRequest(makeAudioFormData(), {
				getEnv: () => {
					throw new Error("Invalid server environment: broken");
				},
			}),
		);

		expect(chunks).toEqual([
			{
				kind: "error",
				status: 500,
				message: "Translation service is not configured correctly.",
			},
		]);
	});
});
