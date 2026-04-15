const NS = "translate.perf";

export function utf8ByteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

export function perfNowMs(): number {
	return performance.now();
}

export function logTranslatePerf(
	event: string,
	fields: Record<string, unknown> = {},
): void {
	console.log(
		JSON.stringify({
			ts: new Date().toISOString(),
			ns: NS,
			event,
			...fields,
		}),
	);
}
