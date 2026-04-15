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
const backendDevVars = join(root, "apps", "backend", ".dev.vars");
if (existsSync(backendDevVars)) dotenv.config({ path: backendDevVars });

const sharedUse = {
	...devices["Desktop Chrome"],
	baseURL: "http://127.0.0.1:3000",
	permissions: ["microphone"],
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			"--use-fake-device-for-media-stream",
			`--use-file-for-fake-audio-capture=${fakeAudioWav}`,
		],
	},
};

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	use: sharedUse,
	webServer: [
		{
			command: "pnpm --filter @lingo-now/backend dev",
			url: "http://localhost:8787/health",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "pnpm exec vite dev --port 3000",
			url: "http://127.0.0.1:3000",
			reuseExistingServer: !process.env.CI,
			env: {
				...process.env,
				VITE_BACKEND_URL:
					process.env.VITE_BACKEND_URL || "http://localhost:8787",
			},
		},
	],
});
