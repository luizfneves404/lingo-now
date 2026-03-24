import { z } from "zod";

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

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
	if (cached) return cached;
	const result = serverEnvSchema.safeParse(process.env);
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
