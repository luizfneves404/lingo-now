const CARTESIA_VOICE_ID_BY_LANG: Record<string, string> = {
	en: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
	pt: "700d1ee3-a641-4018-ba6e-899dcadc9e2b",
	es: "15d0c2e2-8d29-44c3-be23-d585d5f154a1",
	fr: "ab636c8b-9960-4fb3-bb0c-b7b655fb9745",
	de: "384b625b-da5d-49e8-a76d-a2855d4f31eb",
	it: "ee16f140-f6dc-490e-a1ed-c1d537ea0086",
	ja: "2b568345-1d48-4047-b25f-7baccf842eb0",
	ko: "15628352-2ede-4f1b-89e6-ceda0c983fbc",
	zh: "6eb8965c-e295-47bd-a9e4-3eeebb3abcff",
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
