import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

const root = dirname(fileURLToPath(import.meta.url));
const fakeAudioWav = join(root, "e2e", "fixtures", "I_have_friends.wav");

const envDotenv = join(root, ".env");
if (existsSync(envDotenv)) dotenv.config({ path: envDotenv });
const envLocal = join(root, ".env.local");
if (existsSync(envLocal)) dotenv.config({ path: envLocal, override: true });

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: "http://localhost:3000",
		...devices["Desktop Chrome"],
		launchOptions: {
			args: [
				"--use-fake-ui-for-media-stream",
				`--use-file-for-fake-audio-capture=${fakeAudioWav}`,
			],
		},
	},
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		env: {
			...process.env,
			TRANSLATE_DEV_ECHO: "0",
		},
	},
});
