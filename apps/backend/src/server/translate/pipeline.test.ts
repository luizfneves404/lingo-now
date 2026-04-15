import { describe, expect, it, vi } from "vitest";
import { runSpeechTranslatePipelineStream } from "#/server/translate/pipeline";
import type {
	SpeechTranslatePorts,
	TranslateSpeechStreamChunk,
} from "#/server/translate/pipeline-types";

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

async function collectStreamChunks(
	stream: ReadableStream<TranslateSpeechStreamChunk>,
): Promise<TranslateSpeechStreamChunk[]> {
	const reader = stream.getReader();
	const chunks: TranslateSpeechStreamChunk[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
	}
	return chunks;
}

function pcmStreamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

type Listener = (ev: { data?: string }) => void;

function createFailingOpenWebSocket(): (url: string) => WebSocket {
	return (_url: string) => {
		const errorListeners: Listener[] = [];
		const ws = {
			readyState: 0,
			addEventListener(type: string, fn: EventListener) {
				const l = fn as unknown as Listener;
				if (type === "error") {
					errorListeners.push(l);
				}
			},
			removeEventListener() {},
			send: vi.fn(),
			close: vi.fn(),
		};
		queueMicrotask(() => {
			for (const fn of errorListeners) {
				fn({});
			}
		});
		return ws as unknown as WebSocket;
	};
}

function createCartesiaWebSocketMock(
	onSend: (payload: Record<string, unknown>) => void,
): (url: string) => WebSocket {
	return (url: string) => {
		expect(url).toContain("api.cartesia.ai");
		expect(url).toContain("api_key=cartesia-test");
		expect(url).toContain("cartesia_version=2025-04-16");

		const openListeners: Listener[] = [];
		const messageListeners: Listener[] = [];

		const ws = {
			readyState: 0,
			addEventListener(type: string, fn: EventListener) {
				const l = fn as unknown as Listener;
				if (type === "open") {
					openListeners.push(l);
				}
				if (type === "message") {
					messageListeners.push(l);
				}
			},
			removeEventListener() {},
			send(data: string) {
				const payload = JSON.parse(data) as Record<string, unknown>;
				onSend(payload);
				queueMicrotask(() => {
					const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
					const b64 = Buffer.from(pcm).toString("base64");
					for (const fn of messageListeners) {
						fn({
							data: JSON.stringify({
								type: "chunk",
								data: b64,
								done: false,
								status_code: 206,
								step_time: 1,
							}),
						});
					}
					for (const fn of messageListeners) {
						fn({
							data: JSON.stringify({
								type: "done",
								done: true,
								status_code: 200,
							}),
						});
					}
				});
			},
			close: vi.fn(),
		};

		queueMicrotask(() => {
			(ws as { readyState: number }).readyState = WebSocket.OPEN;
			for (const fn of openListeners) {
				fn({});
			}
		});

		return ws as unknown as WebSocket;
	};
}

describe("runSpeechTranslatePipelineStream (orchestrator, injected ports)", () => {
	it("runs transcribe → translate → synthesize with stub ports", async () => {
		const pcm = new Uint8Array([1, 2, 3, 4]);
		const transcribe = vi.fn().mockResolvedValue({ text: "hello" });
		const translate = vi.fn().mockResolvedValue({ translated: "hola" });
		const synthesize = vi.fn().mockResolvedValue({
			ok: true as const,
			stream: pcmStreamFrom(pcm),
		});
		const ports: SpeechTranslatePorts = { transcribe, translate, synthesize };

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const correlationId = "22222222-2222-4222-8222-222222222222";

		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{
					audio,
					from: "en",
					to: "es",
					mime: "audio/webm",
					correlationId,
				},
				{ ports },
			),
		);

		expect(chunks.map((c) => c.kind)).toEqual([
			"transcript",
			"translation",
			"ready",
			"audio",
			"complete",
		]);
		expect(chunks[0]).toEqual({ kind: "transcript", text: "hello" });
		expect(chunks[1]).toEqual({ kind: "translation", text: "hola" });
		const audioChunksOnly = chunks.filter(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "audio" }> =>
				c.kind === "audio",
		);
		expect(audioChunksOnly).toHaveLength(1);
		expect(audioChunksOnly[0]?.pcm).toEqual(pcm);

		expect(transcribe).toHaveBeenCalledTimes(1);
		expect(transcribe).toHaveBeenCalledWith({
			audio,
			fromLang: "en",
			mimeHint: "audio/webm",
			correlationId,
		});
		expect(translate).toHaveBeenCalledWith({
			text: "hello",
			fromLang: "en",
			toLang: "es",
			correlationId,
		});
		expect(synthesize).toHaveBeenCalledWith({
			text: "hola",
			toLang: "es",
			correlationId,
		});
	});

	it("returns 503 when config is null and no ports", async () => {
		const fetchMock = vi.fn();
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{ fetch: fetchMock, config: null },
			),
		);
		expect(chunks).toEqual([
			{
				kind: "error",
				status: 503,
				message: expect.stringContaining("Groq and Cartesia") as string,
			},
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 400 when transcription is empty", async () => {
		const transcribe = vi.fn().mockResolvedValue({ text: "   " });
		const translate = vi.fn();
		const synthesize = vi.fn();
		const ports: SpeechTranslatePorts = { transcribe, translate, synthesize };

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{ ports },
			),
		);
		expect(chunks[0]?.kind).toBe("error");
		if (chunks[0]?.kind === "error") {
			expect(chunks[0].status).toBe(400);
			expect(chunks[0].message).toContain("No speech detected");
		}
		expect(transcribe).toHaveBeenCalledTimes(1);
		expect(translate).not.toHaveBeenCalled();
		expect(synthesize).not.toHaveBeenCalled();
	});

	it("returns 502 when transcribe fails", async () => {
		const transcribe = vi.fn().mockResolvedValue({
			ok: false as const,
			status: 502,
			message: "asr down",
		});
		const ports: SpeechTranslatePorts = {
			transcribe,
			translate: vi.fn(),
			synthesize: vi.fn(),
		};

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{ ports },
			),
		);
		expect(chunks[0]?.kind).toBe("error");
		if (chunks[0]?.kind === "error") {
			expect(chunks[0].status).toBe(502);
			expect(chunks[0].message).toContain("asr down");
		}
	});

	it("returns 502 when translate fails", async () => {
		const transcribe = vi.fn().mockResolvedValue({ text: "hi" });
		const translate = vi.fn().mockResolvedValue({
			ok: false as const,
			status: 502,
			message: "mt down",
		});
		const ports: SpeechTranslatePorts = {
			transcribe,
			translate,
			synthesize: vi.fn(),
		};

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{ ports },
			),
		);
		expect(chunks.map((c) => c.kind)).toEqual(["transcript", "error"]);
		const err = chunks.find(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "error" }> =>
				c.kind === "error",
		);
		expect(err?.status).toBe(502);
		expect(err?.message).toContain("mt down");
	});

	it("returns 502 when synthesize fails", async () => {
		const transcribe = vi.fn().mockResolvedValue({ text: "hello" });
		const translate = vi.fn().mockResolvedValue({ translated: "hola" });
		const synthesize = vi.fn().mockResolvedValue({
			ok: false as const,
			status: 502,
			message: "tts error",
		});
		const ports: SpeechTranslatePorts = {
			transcribe,
			translate,
			synthesize,
		};

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{ ports },
			),
		);
		expect(chunks.map((c) => c.kind)).toEqual([
			"transcript",
			"translation",
			"error",
		]);
		const err = chunks.find(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "error" }> =>
				c.kind === "error",
		);
		expect(err?.status).toBe(502);
		expect(err?.message).toContain("tts error");
	});
});

describe("createGroqCartesiaPorts (adapter, mocked fetch + WebSocket)", () => {
	it("runs transcribe → translate → tts with mocked fetch and Cartesia WS", async () => {
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
				return new Response("not found", { status: 404 });
			},
		);

		let sentGeneration: Record<string, unknown> | null = null;
		const connectWs = createCartesiaWebSocketMock((payload) => {
			sentGeneration = payload;
		});

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});

		const pipelineCorrelationId = "11111111-1111-4111-8111-111111111111";
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{
					audio,
					from: "en",
					to: "es",
					mime: "audio/webm",
					correlationId: pipelineCorrelationId,
				},
				{
					fetch: fetchMock,
					config: fakeConfig,
					connectWebSocket: connectWs,
				},
			),
		);

		expect(chunks.map((c) => c.kind)).toEqual([
			"transcript",
			"translation",
			"ready",
			"audio",
			"complete",
		]);
		expect(chunks[0]).toEqual({ kind: "transcript", text: "hello" });
		expect(chunks[1]).toEqual({ kind: "translation", text: "hola" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(
			(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
		).toMatchObject({ "X-Request-ID": pipelineCorrelationId });
		expect(sentGeneration).toMatchObject({
			model_id: "sonic-3",
			transcript: "hola",
			language: "es",
			context_id: pipelineCorrelationId,
			voice: { mode: "id", id: "15d0c2e2-8d29-44c3-be23-d585d5f154a1" },
			output_format: {
				container: "raw",
				encoding: "pcm_s16le",
				sample_rate: 44100,
			},
			continue: false,
		});
	});

	it("uses built-in Spanish voice for es-MX target", async () => {
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
				return new Response("not found", { status: 404 });
			},
		);

		let sentGeneration: Record<string, unknown> | null = null;
		const connectWs = createCartesiaWebSocketMock((payload) => {
			sentGeneration = payload;
		});

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es-MX", mime: "audio/webm" },
				{ fetch: fetchMock, config: fakeConfig, connectWebSocket: connectWs },
			),
		);

		expect(sentGeneration).toMatchObject({
			voice: { mode: "id", id: "15d0c2e2-8d29-44c3-be23-d585d5f154a1" },
		});
	});

	it("uses fallback voice ID for unmapped target language", async () => {
		const fetchMock = vi.fn(
			async (input: RequestInfo | URL, _?: RequestInit) => {
				const u = requestUrl(input);
				if (u.includes("/audio/transcriptions")) {
					return jsonResponse({ text: "hello" });
				}
				if (u.includes("/chat/completions")) {
					return jsonResponse({
						choices: [{ message: { content: "x" } }],
					});
				}
				return new Response("not found", { status: 404 });
			},
		);

		let sentGeneration: Record<string, unknown> | null = null;
		const connectWs = createCartesiaWebSocketMock((payload) => {
			sentGeneration = payload;
		});

		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "zz-unmapped", mime: "audio/webm" },
				{ fetch: fetchMock, config: fakeConfig, connectWebSocket: connectWs },
			),
		);

		expect(sentGeneration).toMatchObject({
			voice: { mode: "id", id: "voice-1" },
		});
	});

	it("returns 502 when Groq transcription fails", async () => {
		const fetchMock = vi.fn(
			async () => new Response("bad request", { status: 400 }),
		);
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{
					fetch: fetchMock,
					config: fakeConfig,
					connectWebSocket: createCartesiaWebSocketMock(() => {}),
				},
			),
		);
		expect(chunks[0]?.kind).toBe("error");
		if (chunks[0]?.kind === "error") {
			expect(chunks[0].status).toBe(502);
			expect(chunks[0].message).toContain("bad request");
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
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{
					fetch: fetchMock,
					config: fakeConfig,
					connectWebSocket: createCartesiaWebSocketMock(() => {}),
				},
			),
		);
		expect(chunks.map((c) => c.kind)).toEqual(["transcript", "error"]);
		const err = chunks.find(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "error" }> =>
				c.kind === "error",
		);
		expect(err?.status).toBe(502);
		expect(err?.message).toContain("empty text");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns 502 when Cartesia WebSocket cannot connect", async () => {
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
			return new Response("unexpected", { status: 500 });
		});
		const audio = new File([new Uint8Array([0])], "rec.webm", {
			type: "audio/webm",
		});
		const chunks = await collectStreamChunks(
			runSpeechTranslatePipelineStream(
				{ audio, from: "en", to: "es", mime: "audio/webm" },
				{
					fetch: fetchMock,
					config: fakeConfig,
					connectWebSocket: createFailingOpenWebSocket(),
				},
			),
		);
		expect(chunks.map((c) => c.kind)).toEqual([
			"transcript",
			"translation",
			"error",
		]);
		const err = chunks.find(
			(c): c is Extract<TranslateSpeechStreamChunk, { kind: "error" }> =>
				c.kind === "error",
		);
		expect(err?.status).toBe(502);
		expect(err?.message).toMatch(/connect|text-to-speech/i);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
