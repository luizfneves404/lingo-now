import { expect, test } from "@playwright/test";

test.describe("walkie-talkie happy path (dev echo)", () => {
	test("records fixture audio, uses dev-echo, and ends with correct UI", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(
			page.getByRole("heading", { name: "Lingo Now" }),
		).toBeVisible();

		const pwd = process.env.TRANSLATE_ACCESS_PASSWORD?.trim();
		if (pwd) {
			await page.getByPlaceholder(/TRANSLATE_ACCESS_PASSWORD/).fill(pwd);
		}

		const fromSelect = page.getByRole("combobox", { name: /^From$/ });
		const toSelect = page.getByRole("combobox", { name: /^To$/ });
		await expect(fromSelect).toHaveValue("en");
		await expect(toSelect).toHaveValue("pt");

		await page.getByRole("button", { name: "Start" }).click();
		await page.waitForTimeout(750);
		await page.getByRole("button", { name: "Stop" }).click();

		await expect(page.getByTestId("playback-status")).toHaveText("done");

		await expect(page.getByTestId("transcript-text")).toContainText(
			"[dev echo]",
		);
		await expect(page.getByTestId("translation-text")).toContainText(
			"[dev echo]",
		);

		await expect(page.getByRole("alert")).toHaveCount(0);

		await expect(fromSelect).toHaveValue("pt");
		await expect(toSelect).toHaveValue("en");

		await expect(page.getByText("Translating…")).toHaveCount(0);
		await expect(page.getByText("Playing…")).toHaveCount(0);
	});
});
