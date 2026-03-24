import { describe, expect, it, vi } from "vitest";
import { serverEnvSchema } from "#/server/env";
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

function decodeBase64(data: string): Uint8Array {
	return Uint8Array.from(Buffer.from(data, "base64"));
}

describe("translateSpeechRequest", () => {
	it("returns 400 when audio or language codes are missing", async () => {
		const result = await translateSpeechRequest(new FormData(), {
			env: serverEnvSchema.parse({
				TRANSLATE_DEV_ECHO: "1",
			}),
		});

		expect(result).toEqual({
			ok: false,
			status: 400,
			message: "Missing audio file or language codes.",
		});
	});

	it("returns 400 when language codes are blank", async () => {
		const formData = makeAudioFormData();
		formData.set("from", "  ");

		const result = await translateSpeechRequest(formData, {
			env: serverEnvSchema.parse({
				TRANSLATE_DEV_ECHO: "1",
			}),
		});

		expect(result).toEqual({
			ok: false,
			status: 400,
			message: "Missing audio file or language codes.",
		});
	});

	it("returns 401 when the access password is invalid", async () => {
		const formData = makeAudioFormData();
		formData.set("accessPassword", "wrong");

		const result = await translateSpeechRequest(formData, {
			env: serverEnvSchema.parse({
				TRANSLATE_DEV_ECHO: "1",
				TRANSLATE_ACCESS_PASSWORD: "secret",
			}),
		});

		expect(result).toEqual({
			ok: false,
			status: 401,
			message: "Invalid or missing access password.",
		});
	});

	it("returns 401 when the access password is missing", async () => {
		const result = await translateSpeechRequest(makeAudioFormData(), {
			env: serverEnvSchema.parse({
				TRANSLATE_DEV_ECHO: "1",
				TRANSLATE_ACCESS_PASSWORD: "secret",
			}),
		});

		expect(result).toEqual({
			ok: false,
			status: 401,
			message: "Invalid or missing access password.",
		});
	});

	it("echoes the uploaded audio in dev echo mode", async () => {
		const formData = makeAudioFormData();

		const result = await translateSpeechRequest(formData, {
			env: serverEnvSchema.parse({
				TRANSLATE_DEV_ECHO: "1",
			}),
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.contentType).toBe("audio/webm");
			expect(decodeBase64(result.audioBase64)).toEqual(
				new Uint8Array([1, 2, 3]),
			);
		}
	});

	it("passes pipeline failures through as typed app errors", async () => {
		const formData = makeAudioFormData();
		const runPipeline = vi.fn(async () => ({
			ok: false as const,
			status: 502,
			message: "upstream failed",
		}));

		const result = await translateSpeechRequest(formData, {
			env: serverEnvSchema.parse({
				GROQ_API_KEY: "groq",
				CARTESIA_API_KEY: "cartesia",
			}),
			runPipeline,
		});

		expect(result).toEqual({
			ok: false,
			status: 502,
			message: "upstream failed",
		});
		expect(runPipeline).toHaveBeenCalledOnce();
	});

	it("encodes successful pipeline audio into the typed response", async () => {
		const result = await translateSpeechRequest(makeAudioFormData(), {
			env: serverEnvSchema.parse({
				GROQ_API_KEY: "groq",
				CARTESIA_API_KEY: "cartesia",
			}),
			runPipeline: vi.fn(async () => ({
				ok: true as const,
				body: new Uint8Array([4, 5, 6]).buffer,
				contentType: "audio/wav",
			})),
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.contentType).toBe("audio/wav");
			expect(decodeBase64(result.audioBase64)).toEqual(
				new Uint8Array([4, 5, 6]),
			);
		}
	});

	it("normalizes thrown runtime errors into typed failures", async () => {
		const formData = makeAudioFormData();

		const result = await translateSpeechRequest(formData, {
			env: serverEnvSchema.parse({
				GROQ_API_KEY: "groq",
				CARTESIA_API_KEY: "cartesia",
			}),
			runPipeline: vi.fn(async () => {
				throw new Error("fetch failed");
			}),
		});

		expect(result).toEqual({
			ok: false,
			status: 502,
			message: "fetch failed",
		});
	});

	it("returns a stable message when server env parsing throws", async () => {
		const result = await translateSpeechRequest(makeAudioFormData(), {
			getEnv: () => {
				throw new Error("Invalid server environment: broken");
			},
		});

		expect(result).toEqual({
			ok: false,
			status: 500,
			message: "Translation service is not configured correctly.",
		});
	});
});
