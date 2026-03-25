import { expect, test } from "@playwright/test";

test.describe("walkie-talkie happy path (real providers)", () => {
	test("records fixture audio, translates en→pt, plays TTS, swaps languages", async ({
		page,
	}) => {
		await page.goto("/?translateDevEcho=0");
		await expect(page.getByTestId("hydration-status")).toHaveText("ready");

		const pwd = process.env.TRANSLATE_ACCESS_PASSWORD?.trim();
		if (pwd) {
			await page.getByPlaceholder(/TRANSLATE_ACCESS_PASSWORD/).fill(pwd);
		}

		const fromSelect = page.getByRole("combobox", { name: /^From$/ });
		const toSelect = page.getByRole("combobox", { name: /^To$/ });
		await expect(fromSelect).toHaveValue("en");
		await expect(toSelect).toHaveValue("pt");

		test.skip(
			!process.env.GROQ_API_KEY?.trim() ||
				!process.env.CARTESIA_API_KEY?.trim(),
			"Set GROQ_API_KEY and CARTESIA_API_KEY to run this test.",
		);

		const startButton = page.getByRole("button", { name: "Start" });
		const stopButton = page.getByRole("button", { name: "Stop" });
		await startButton.click();
		await expect(stopButton).toBeVisible();
		await page.waitForTimeout(3500);
		await stopButton.click();

		await expect(page.getByTestId("playback-status")).toHaveText("done");

		const transcript = page.getByTestId("transcript-text");
		const translation = page.getByTestId("translation-text");
		await expect(transcript).toContainText("I have friends");
		await expect(translation).toContainText(/^(Eu\s+)?tenho amigos\.?$/i);

		await expect(page.getByRole("alert")).toHaveCount(0);

		await expect(fromSelect).toHaveValue("pt");
		await expect(toSelect).toHaveValue("en");
	});
});
