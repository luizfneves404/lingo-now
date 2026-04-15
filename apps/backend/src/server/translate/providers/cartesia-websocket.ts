export type CartesiaWsInbound =
	| { type: "chunk"; data: string }
	| { type: "done" }
	| { type: "error"; error: string; status_code?: number }
	| { type: "timestamps" }
	| Record<string, unknown>;

export function buildCartesiaWebSocketUrl(
	apiKey: string,
	cartesiaVersion: string,
): string {
	const params = new URLSearchParams({
		api_key: apiKey,
		cartesia_version: cartesiaVersion,
	});
	return `wss://api.cartesia.ai/tts/websocket?${params.toString()}`;
}

function waitForWebSocketOpen(ws: WebSocket): Promise<void> {
	if (ws.readyState === WebSocket.OPEN) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const onOpen = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("WebSocket open failed"));
		};
		const onClose = () => {
			cleanup();
			reject(new Error("WebSocket closed before open"));
		};
		function cleanup() {
			ws.removeEventListener("open", onOpen);
			ws.removeEventListener("error", onError);
			ws.removeEventListener("close", onClose);
		}
		ws.addEventListener("open", onOpen);
		ws.addEventListener("error", onError);
		ws.addEventListener("close", onClose);
	});
}

function decodeBase64ToUint8Array(b64: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return Uint8Array.from(Buffer.from(b64, "base64"));
	}
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

function parseInbound(raw: string): CartesiaWsInbound | null {
	try {
		const msg = JSON.parse(raw) as unknown;
		if (!msg || typeof msg !== "object" || !("type" in msg)) return null;
		return msg as CartesiaWsInbound;
	} catch {
		return null;
	}
}

export type CartesiaTtsGeneration = {
	modelId: string;
	transcript: string;
	voiceId: string;
	language: string;
	contextId: string;
};

export async function openCartesiaPcmStream(params: {
	connectWebSocket: (url: string) => WebSocket;
	apiKey: string;
	cartesiaVersion: string;
	generation: CartesiaTtsGeneration;
}): Promise<
	| { ok: true; stream: ReadableStream<Uint8Array> }
	| { ok: false; status: number; message: string }
> {
	const url = buildCartesiaWebSocketUrl(params.apiKey, params.cartesiaVersion);
	const ws = params.connectWebSocket(url);

	try {
		await waitForWebSocketOpen(ws);
	} catch {
		return {
			ok: false,
			status: 502,
			message: "Could not connect to text-to-speech service.",
		};
	}

	const payload = {
		model_id: params.generation.modelId,
		transcript: params.generation.transcript,
		voice: { mode: "id" as const, id: params.generation.voiceId },
		language: params.generation.language,
		context_id: params.generation.contextId,
		output_format: {
			container: "raw",
			encoding: "pcm_s16le",
			sample_rate: 44100,
		},
		continue: false,
	};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let finished = false;

			const finishClose = () => {
				if (finished) return;
				finished = true;
				try {
					ws.close();
				} catch {
					/* ignore */
				}
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			};

			ws.addEventListener("message", (event) => {
				const raw =
					typeof event.data === "string"
						? event.data
						: event.data instanceof ArrayBuffer
							? new TextDecoder().decode(event.data)
							: "";
				const msg = parseInbound(raw);
				if (!msg) {
					controller.error(new Error("Invalid TTS message"));
					return;
				}
				if (msg.type === "chunk" && typeof msg.data === "string") {
					const pcm = decodeBase64ToUint8Array(msg.data);
					if (pcm.byteLength > 0) {
						controller.enqueue(pcm);
					}
					return;
				}
				if (msg.type === "error") {
					const m =
						"error" in msg && typeof msg.error === "string"
							? msg.error
							: "Text-to-speech failed.";
					const st =
						"status_code" in msg && typeof msg.status_code === "number"
							? msg.status_code
							: 502;
					const code = st >= 400 && st < 600 ? st : 502;
					try {
						ws.close();
					} catch {
						/* ignore */
					}
					controller.error(Object.assign(new Error(m), { status: code }));
					return;
				}
				if (msg.type === "done") {
					finishClose();
				}
			});

			ws.addEventListener("error", () => {
				if (!finished) {
					try {
						ws.close();
					} catch {
						/* ignore */
					}
					controller.error(new Error("Text-to-speech stream error"));
				}
			});

			ws.addEventListener("close", () => {
				if (!finished) {
					finished = true;
					try {
						controller.close();
					} catch {
						/* ignore */
					}
				}
			});

			ws.send(JSON.stringify(payload));
		},
		cancel() {
			try {
				ws.close();
			} catch {
				/* ignore */
			}
		},
	});

	return { ok: true, stream };
}
