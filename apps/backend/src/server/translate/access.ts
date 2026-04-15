import type { ServerEnv } from "#/server/env";

function timingSafeEqualUtf8(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const ba = enc.encode(a);
	const bb = enc.encode(b);
	if (ba.length !== bb.length) return false;
	let diff = 0;
	for (let i = 0; i < ba.length; i++) {
		const x = ba[i];
		const y = bb[i];
		if (x === undefined || y === undefined) return false;
		diff |= x ^ y;
	}
	return diff === 0;
}

export function translateAccessDeniedResponse(
	formData: FormData,
	env: ServerEnv,
): Response | null {
	const message = translateAccessDeniedMessage(formData, env);
	if (message) {
		return new Response(JSON.stringify({ error: message }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}
	return null;
}

export function translateAccessDeniedMessage(
	formData: FormData,
	env: ServerEnv,
): string | null {
	const expected = env.TRANSLATE_ACCESS_PASSWORD;
	if (!expected) return null;
	const raw = formData.get("accessPassword");
	const provided = typeof raw === "string" ? raw : "";
	if (!timingSafeEqualUtf8(provided, expected)) {
		return "Invalid or missing access password.";
	}
	return null;
}
