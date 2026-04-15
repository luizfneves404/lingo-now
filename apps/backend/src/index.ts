import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import {
	serverEnvFromWorkerBindings,
	type WorkerEnv,
} from "../../../src/server/env";
import type { TranslateSpeechStreamChunk } from "../../../src/server/translate/pipeline-types";
import { translateSpeechRequest } from "../../../src/server/translate/request";
import type { TranslateSpeechWireChunk } from "../../../src/server/translate/wire-types";

const app = new Hono<{ Bindings: WorkerEnv }>();

app.get("/health", (c) => c.json({ ok: true }, 200));

app.use("/rpc/*", async (c, next) => {
	const configuredOrigin = c.env.CORS_ORIGIN?.trim();
	const fallbackOrigins = ["http://127.0.0.1:3000", "http://localhost:3000"];
	const allowedOrigins = configuredOrigin
		? configuredOrigin.split(",").map((value) => value.trim())
		: fallbackOrigins;

	return cors({
		origin: (origin) => {
			if (!origin) return "";
			return allowedOrigins.includes(origin) ? origin : "";
		},
		allowHeaders: ["Content-Type"],
		allowMethods: ["POST", "OPTIONS"],
		exposeHeaders: ["Content-Type"],
		maxAge: 86400,
	})(c, next);
});

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
