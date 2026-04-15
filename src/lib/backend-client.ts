import { hc } from "hono/client";
import type { TranslateSpeechStreamChunk } from "#/server/translate/pipeline-types";
import type { TranslateSpeechWireChunk } from "#/server/translate/wire-types";
import type { BackendRpcType } from "../../apps/backend/src/index.ts";

const API_BASE_URL =
	import.meta.env.VITE_BACKEND_URL?.trim() || "http://localhost:8787";

const client = hc<BackendRpcType>(API_BASE_URL);

function decodeWireChunk(
	chunk: TranslateSpeechWireChunk,
): TranslateSpeechStreamChunk {
	if (chunk.kind !== "audio") {
		return chunk;
	}
	const pcm = Uint8Array.from(atob(chunk.pcmBase64), (char) =>
		char.charCodeAt(0),
	);
	return { kind: "audio", pcm };
}

export async function translateSpeechViaRpc(
	form: FormData,
): Promise<ReadableStream<TranslateSpeechStreamChunk>> {
	const endpoint = client.rpc.translate.$url();
	const response = await fetch(endpoint, {
		method: "POST",
		body: form,
	});
	if (!response.ok || !response.body) {
		throw new Error("Translation request failed.");
	}
	const textStream = response.body.pipeThrough(new TextDecoderStream());
	return new ReadableStream<TranslateSpeechStreamChunk>({
		start(controller) {
			const reader = textStream.getReader();
			let buffered = "";
			void (async () => {
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						buffered += value;
						for (;;) {
							const newlineIndex = buffered.indexOf("\n");
							if (newlineIndex < 0) break;
							const line = buffered.slice(0, newlineIndex).trim();
							buffered = buffered.slice(newlineIndex + 1);
							if (!line) continue;
							const wireChunk = JSON.parse(line) as TranslateSpeechWireChunk;
							controller.enqueue(decodeWireChunk(wireChunk));
						}
					}
					if (buffered.trim()) {
						const wireChunk = JSON.parse(
							buffered.trim(),
						) as TranslateSpeechWireChunk;
						controller.enqueue(decodeWireChunk(wireChunk));
					}
					controller.close();
				} catch (error) {
					controller.error(error);
				} finally {
					reader.releaseLock();
				}
			})();
		},
	});
}
