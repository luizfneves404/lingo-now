import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "#/server/env";
import { translateAccessDeniedResponse } from "#/server/translate/access";

describe("translateAccessDeniedResponse", () => {
	it("allows requests when no access password is configured", () => {
		const env = serverEnvSchema.parse({
			TRANSLATE_DEV_ECHO: "1",
		});
		const formData = new FormData();

		expect(translateAccessDeniedResponse(formData, env)).toBeNull();
	});

	it("rejects requests when the password is missing or wrong", async () => {
		const env = serverEnvSchema.parse({
			TRANSLATE_DEV_ECHO: "1",
			TRANSLATE_ACCESS_PASSWORD: "secret",
		});
		const formData = new FormData();
		formData.set("accessPassword", "nope");

		const response = translateAccessDeniedResponse(formData, env);

		expect(response?.status).toBe(401);
		await expect(response?.json()).resolves.toEqual({
			error: "Invalid or missing access password.",
		});
	});

	it("rejects requests when the password is omitted", async () => {
		const env = serverEnvSchema.parse({
			TRANSLATE_DEV_ECHO: "1",
			TRANSLATE_ACCESS_PASSWORD: "secret",
		});

		const response = translateAccessDeniedResponse(new FormData(), env);

		expect(response?.status).toBe(401);
		await expect(response?.json()).resolves.toEqual({
			error: "Invalid or missing access password.",
		});
	});

	it("accepts requests with the configured password", () => {
		const env = serverEnvSchema.parse({
			TRANSLATE_DEV_ECHO: "1",
			TRANSLATE_ACCESS_PASSWORD: "secret",
		});
		const formData = new FormData();
		formData.set("accessPassword", "secret");

		expect(translateAccessDeniedResponse(formData, env)).toBeNull();
	});
});
