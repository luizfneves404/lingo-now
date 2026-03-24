const CARTESIA_VOICE_ID_BY_LANG: Record<string, string> = {
	en: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
	pt: "700d1ee3-a641-4018-ba6e-899dcadc9e2b",
	es: "15d0c2e2-8d29-44c3-be23-d585d5f154a1",
};

export function baseLanguageCode(lang: string): string {
	const t = lang.trim().toLowerCase();
	const i = t.indexOf("-");
	return i === -1 ? t : t.slice(0, i);
}

export function resolveCartesiaVoiceId(
	targetLang: string,
	fallbackVoiceId: string,
): string {
	const base = baseLanguageCode(targetLang);
	const mapped = CARTESIA_VOICE_ID_BY_LANG[base];
	if (mapped) return mapped;
	return fallbackVoiceId;
}
