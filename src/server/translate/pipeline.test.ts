import { describe, expect, it, vi } from "vitest";
import { runSpeechTranslatePipeline } from "#/server/translate/pipeline";

const fakeConfig = {
	groqApiKey: "groq-test",
	cartesiaApiKey: "cartesia-test",
	cartesiaFallbackVoiceId: "voice-1",
	cartesiaVersion: "2025-04-16",
	cartesiaModelId: "sonic-3",
};

function jsonResponse(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

describe("runSpeechTranslatePipeline", () => {
	it("runs transcribe → translate → tts with mocked fetch", async () => {
		const wavBytes = new Uint8Array([1, 2, 3, 4]).buffer;

		// 1. ADD `init?: RequestInit` to the signature so TS knows about the 2nd argument
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, _?: RequestInit) => {
				const u = requestUrl(input); // Assuming requestUrl handles Request objects or strings
				if (u.includes("/audio/transcriptions")) {
					return jsonResponse({ text: "hello" });
				}
				if (u.includes("/chat/completions")) {
					return jsonResponse({
						choices: [{ message: { content: "hola" } }],
					});
				}
				if (u.includes("cartesia.ai")) {
					return new Response(wavBytes, {
						headers: { "Content-Type": "audio/wav" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		);

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});

		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.contentType).toBe("audio/wav");
			expect(new Uint8Array(result.body)).toEqual(new Uint8Array(wavBytes));
		}

		expect(fetchMock).toHaveBeenCalledTimes(3);

		// 2. Wrap the first call in String() just like the others to satisfy `toContain`
		// if `input` happens to be a Request object instead of a raw string/URL.
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("groq.com");
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain("groq.com");
		expect(String(fetchMock.mock.calls[2]?.[0])).toContain("cartesia.ai");

		// 3. Cleaner typing for the body parsing (no need to cast the whole array element)
		const ttsInit = fetchMock.mock.calls[2]?.[1];
		const ttsBody = JSON.parse(String(ttsInit?.body)) as {
			voice: { id: string };
		};

		expect(ttsBody.voice.id).toBe("15d0c2e2-8d29-44c3-be23-d585d5f154a1");
	});

	it("uses built-in Spanish voice for es-MX target", async () => {
		const wavBytes = new Uint8Array([1]).buffer;
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, _?: RequestInit) => {
				const u = requestUrl(input);
				if (u.includes("/audio/transcriptions")) {
					return jsonResponse({ text: "hello" });
				}
				if (u.includes("/chat/completions")) {
					return jsonResponse({
						choices: [{ message: { content: "hola" } }],
					});
				}
				if (u.includes("cartesia.ai")) {
					return new Response(wavBytes, {
						headers: { "Content-Type": "audio/wav" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		);

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es-MX", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);

		const ttsInit = fetchMock.mock.calls[2]?.[1];
		const ttsBody = JSON.parse(String(ttsInit?.body)) as {
			voice: { id: string };
		};
		expect(ttsBody.voice.id).toBe("15d0c2e2-8d29-44c3-be23-d585d5f154a1");
	});

	it("uses fallback voice ID for unmapped target language", async () => {
		const wavBytes = new Uint8Array([1]).buffer;
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, _?: RequestInit) => {
				const u = requestUrl(input);
				if (u.includes("/audio/transcriptions")) {
					return jsonResponse({ text: "hello" });
				}
				if (u.includes("/chat/completions")) {
					return jsonResponse({
						choices: [{ message: { content: "bonjour" } }],
					});
				}
				if (u.includes("cartesia.ai")) {
					return new Response(wavBytes, {
						headers: { "Content-Type": "audio/wav" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		);

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "fr", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);

		const ttsInit = fetchMock.mock.calls[2]?.[1];
		const ttsBody = JSON.parse(String(ttsInit?.body)) as {
			voice: { id: string };
		};
		expect(ttsBody.voice.id).toBe("voice-1");
	});

	it("returns 503 when config is null", async () => {
		const fetchMock = vi.fn();
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: null },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(503);
			expect(result.message).toContain("Groq and Cartesia");
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 400 when transcription is empty", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const u = requestUrl(input);
			if (u.includes("/audio/transcriptions")) {
				return jsonResponse({ text: "   " });
			}
			return new Response("unexpected", { status: 500 });
		});
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(400);
			expect(result.message).toContain("No speech detected");
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns 502 when Groq transcription fails", async () => {
		const fetchMock = vi.fn(
			async () => new Response("bad request", { status: 400 }),
		);
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(502);
			expect(result.message).toContain("bad request");
		}
	});

	it("returns 502 when translation content is empty", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const u = requestUrl(input);
			if (u.includes("/audio/transcriptions")) {
				return jsonResponse({ text: "hi" });
			}
			if (u.includes("/chat/completions")) {
				return jsonResponse({
					choices: [{ message: { content: "" } }],
				});
			}
			return new Response("unexpected", { status: 500 });
		});
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(502);
			expect(result.message).toContain("empty text");
		}
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns 502 when Cartesia fails", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const u = requestUrl(input);
			if (u.includes("/audio/transcriptions")) {
				return jsonResponse({ text: "hello" });
			}
			if (u.includes("/chat/completions")) {
				return jsonResponse({
					choices: [{ message: { content: "hola" } }],
				});
			}
			return new Response("tts error", { status: 500 });
		});
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const result = await runSpeechTranslatePipeline(
			{ audio, from: "en", to: "es", mime: "audio/webm" },
			{ fetch: fetchMock, config: fakeConfig },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(502);
			expect(result.message).toContain("tts error");
		}
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
