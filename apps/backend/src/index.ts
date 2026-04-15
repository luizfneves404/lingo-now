import type { TranslateSpeechStreamChunk } from "@lingo-now/contracts/pipeline-types";
import type { TranslateSpeechWireChunk } from "@lingo-now/contracts/wire-types";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { serverEnvFromWorkerBindings, type WorkerEnv } from "./server/env";
import { translateSpeechRequest } from "./server/translate/request";

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use("*", async (c, next) => {
	const configuredOrigin = c.env.CORS_ORIGIN;
	const allowedOrigins = configuredOrigin
		? configuredOrigin.split(",").map((s) => s.trim())
		: ["http://localhost:3000", "http://127.0.0.1:3000"];

	const corsMiddleware = cors({
		origin: (origin) => {
			// If the incoming origin is in our list, return it.
			return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
		},
		allowHeaders: ["Content-Type", "Authorization"], // Added Authorization just in case
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Type"],
		maxAge: 86400,
		credentials: true,
	});

	return corsMiddleware(c, next);
});

app.get("/health", (c) => c.json({ ok: true }, 200));

function encodeChunk(
	chunk: TranslateSpeechStreamChunk,
): TranslateSpeechWireChunk {
	if (chunk.kind !== "audio") {
		return chunk;
	}
	return {
		kind: "audio",
		pcmBase64: Buffer.from(chunk.pcm).toString("base64"),
	};
}

const rpcRoutes = app.post("/rpc/translate", async (c) => {
	const formData = await c.req.formData();
	const env = serverEnvFromWorkerBindings({
		bindings: c.env,
		translateDevEchoFromForm: formData.get("translateDevEcho"),
	});
	const dataStream = translateSpeechRequest(formData, { env });

	c.header("Content-Type", "application/x-ndjson");
	return stream(c, async (output) => {
		const reader = dataStream.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				await output.write(`${JSON.stringify(encodeChunk(value))}\n`);
			}
		} finally {
			reader.releaseLock();
		}
	});
});

export default app;
export type BackendRpcType = typeof rpcRoutes;
