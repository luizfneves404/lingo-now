import { describe, expect, it } from "vitest";
import { serverEnvFromWorkerBindings, serverEnvSchema } from "#/server/env";

describe("serverEnvSchema", () => {
	it("accepts TRANSLATE_DEV_ECHO without provider keys", () => {
		const r = serverEnvSchema.safeParse({
			TRANSLATE_DEV_ECHO: "1",
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.TRANSLATE_DEV_ECHO).toBe(true);
			expect(r.data.GROQ_API_KEY).toBeUndefined();
		}
	});

	it("accepts TRANSLATE_DEV_ECHO true string without provider keys", () => {
		const r = serverEnvSchema.safeParse({
			TRANSLATE_DEV_ECHO: "true",
		});
		expect(r.success).toBe(true);
	});

	it("accepts full provider keys when echo is off", () => {
		const r = serverEnvSchema.safeParse({
			GROQ_API_KEY: "g",
			CARTESIA_API_KEY: "c",
			TRANSLATE_DEV_ECHO: "0",
		});
		expect(r.success).toBe(true);
	});

	it("accepts full provider keys when TRANSLATE_DEV_ECHO is unset", () => {
		const r = serverEnvSchema.safeParse({
			GROQ_API_KEY: "g",
			CARTESIA_API_KEY: "c",
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data.TRANSLATE_DEV_ECHO).toBe(false);
		}
	});

	it("rejects missing GROQ_API_KEY when echo is off", () => {
		const r = serverEnvSchema.safeParse({
			CARTESIA_API_KEY: "c",
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.error.issues.some(
					(i) =>
						i.path[0] === "GROQ_API_KEY" &&
						i.message.includes("TRANSLATE_DEV_ECHO"),
				),
			).toBe(true);
		}
	});

	it("rejects whitespace-only keys when echo is off", () => {
		const r = serverEnvSchema.safeParse({
			GROQ_API_KEY: "x",
			CARTESIA_API_KEY: "  ",
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues.some((i) => i.path[0] === "CARTESIA_API_KEY")).toBe(
				true,
			);
		}
	});

	it("adds issues for missing Groq and Cartesia keys when echo is off", () => {
		const r = serverEnvSchema.safeParse({});
		expect(r.success).toBe(false);
		if (!r.success) {
			const paths = r.error.issues.map((i) => i.path[0]);
			expect(paths).toContain("GROQ_API_KEY");
			expect(paths).toContain("CARTESIA_API_KEY");
		}
	});
});

describe("serverEnvFromWorkerBindings", () => {
	it("enables implicit dev echo when provider keys are missing", () => {
		const env = serverEnvFromWorkerBindings({
			bindings: {},
			translateDevEchoFromForm: null,
		});
		expect(env.TRANSLATE_DEV_ECHO).toBe(true);
		expect(env.GROQ_API_KEY).toBeUndefined();
	});

	it("uses bindings and applies schema defaults for Cartesia", () => {
		const env = serverEnvFromWorkerBindings({
			bindings: {
				GROQ_API_KEY: "g",
				CARTESIA_API_KEY: "c",
			},
			translateDevEchoFromForm: null,
		});
		expect(env.TRANSLATE_DEV_ECHO).toBe(false);
		expect(env.CARTESIA_VERSION).toBe("2025-04-16");
		expect(env.CARTESIA_MODEL_ID).toBe("sonic-3");
	});

	it("honors translateDevEcho from form", () => {
		const env = serverEnvFromWorkerBindings({
			bindings: {},
			translateDevEchoFromForm: "1",
		});
		expect(env.TRANSLATE_DEV_ECHO).toBe(true);
	});

	it("falls back to process.env when bindings omit keys", () => {
		const prevG = process.env.GROQ_API_KEY;
		const prevC = process.env.CARTESIA_API_KEY;
		process.env.GROQ_API_KEY = "from-process";
		process.env.CARTESIA_API_KEY = "from-process-c";
		try {
			const env = serverEnvFromWorkerBindings({
				bindings: {},
				translateDevEchoFromForm: null,
			});
			expect(env.GROQ_API_KEY).toBe("from-process");
			expect(env.CARTESIA_API_KEY).toBe("from-process-c");
		} finally {
			process.env.GROQ_API_KEY = prevG;
			process.env.CARTESIA_API_KEY = prevC;
		}
	});
});
