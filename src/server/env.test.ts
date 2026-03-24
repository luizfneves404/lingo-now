import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "#/server/env";

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
