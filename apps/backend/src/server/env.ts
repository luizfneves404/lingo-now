import { type input, z } from "zod";

const optionalTrimmedNonEmpty = z
	.string()
	.optional()
	.transform((s) => {
		if (s === undefined) return undefined;
		const t = s.trim();
		return t.length > 0 ? t : undefined;
	});

const defaultingTrimmedString = (fallback: string) =>
	z
		.string()
		.optional()
		.transform((s) => {
			const t = s?.trim();
			return t && t.length > 0 ? t : fallback;
		});

export const serverEnvSchema = z
	.object({
		GROQ_API_KEY: optionalTrimmedNonEmpty,
		CARTESIA_API_KEY: optionalTrimmedNonEmpty,
		CARTESIA_VERSION: defaultingTrimmedString("2025-04-16"),
		CARTESIA_MODEL_ID: defaultingTrimmedString("sonic-3"),
		TRANSLATE_DEV_ECHO: z
			.string()
			.optional()
			.transform((s) => s === "true" || s === "1"),
		TRANSLATE_ACCESS_PASSWORD: optionalTrimmedNonEmpty,
	})
	.superRefine((data, ctx) => {
		if (data.TRANSLATE_DEV_ECHO) return;
		const keys = [
			["GROQ_API_KEY", data.GROQ_API_KEY],
			["CARTESIA_API_KEY", data.CARTESIA_API_KEY],
		] as const;
		for (const [path, val] of keys) {
			if (!val) {
				ctx.addIssue({
					code: "custom",
					path: [path],
					message: "Required when TRANSLATE_DEV_ECHO is not enabled.",
				});
			}
		}
	});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Cloudflare Worker bindings for translate RPC (plus `CORS_ORIGIN` for HTTP). */
export type WorkerEnv = input<typeof serverEnvSchema> & {
	CORS_ORIGIN?: string;
};

let cached: ServerEnv | null = null;

function parseServerEnv(record: input<typeof serverEnvSchema>) {
	return serverEnvSchema.safeParse(record);
}

/**
 * Builds validated {@link ServerEnv} for the translate RPC from Worker bindings,
 * optional `process.env` fallbacks (local dev), and form-driven dev echo.
 */
export function serverEnvFromWorkerBindings(options: {
	bindings: input<typeof serverEnvSchema>;
	translateDevEchoFromForm?: FormDataEntryValue | null;
}): ServerEnv {
	const { bindings } = options;
	const rawForm = options.translateDevEchoFromForm;
	const translateDevEchoForm =
		typeof rawForm === "string" &&
		(rawForm === "1" || rawForm === "true");

	const groqRaw = bindings.GROQ_API_KEY ?? process.env.GROQ_API_KEY;
	const cartesiaRaw =
		bindings.CARTESIA_API_KEY ?? process.env.CARTESIA_API_KEY;
	const groq = groqRaw?.trim() ? groqRaw : undefined;
	const cartesia = cartesiaRaw?.trim() ? cartesiaRaw : undefined;

	const implicitEcho = !groq && !cartesia;

	const record: input<typeof serverEnvSchema> = {
		GROQ_API_KEY: groq,
		CARTESIA_API_KEY: cartesia,
		CARTESIA_VERSION:
			bindings.CARTESIA_VERSION?.trim() ||
			process.env.CARTESIA_VERSION?.trim() ||
			undefined,
		CARTESIA_MODEL_ID:
			bindings.CARTESIA_MODEL_ID?.trim() ||
			process.env.CARTESIA_MODEL_ID?.trim() ||
			undefined,
		TRANSLATE_DEV_ECHO:
			translateDevEchoForm || implicitEcho
				? "true"
				: (bindings.TRANSLATE_DEV_ECHO ?? process.env.TRANSLATE_DEV_ECHO),
		TRANSLATE_ACCESS_PASSWORD:
			bindings.TRANSLATE_ACCESS_PASSWORD ??
			process.env.TRANSLATE_ACCESS_PASSWORD,
	};

	const result = parseServerEnv(record);
	if (!result.success) {
		const msg = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Invalid server environment: ${msg}`);
	}
	return result.data;
}

export function getServerEnv(): ServerEnv {
	if (cached) return cached;
	const result = parseServerEnv(process.env as input<typeof serverEnvSchema>);
	if (!result.success) {
		const msg = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Invalid server environment: ${msg}`);
	}
	cached = result.data;
	return result.data;
}

export type GroqCartesiaConfig = {
	groqApiKey: string;
	cartesiaApiKey: string;
	cartesiaFallbackVoiceId: string;
	cartesiaVersion: string;
	cartesiaModelId: string;
};

export function getGroqCartesiaConfig(
	env: ServerEnv,
): GroqCartesiaConfig | null {
	const groq = env.GROQ_API_KEY;
	const cartesia = env.CARTESIA_API_KEY;
	if (!groq || !cartesia) return null;
	return {
		groqApiKey: groq,
		cartesiaApiKey: cartesia,
		cartesiaFallbackVoiceId: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
		cartesiaVersion: env.CARTESIA_VERSION,
		cartesiaModelId: env.CARTESIA_MODEL_ID,
	};
}
