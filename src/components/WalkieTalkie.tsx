import { AlertCircleIcon, MicIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";

const selectClassName =
	"w-full rounded-md border border-[var(--line)] bg-white/90 px-3 py-2 text-sm text-[var(--sea-ink)] dark:bg-[var(--surface)]";

const PLACEHOLDER_CAPTIONS = `data:text/vtt;charset=utf-8,${encodeURIComponent("WEBVTT\n\n")}`;

const LANGUAGES: { code: string; label: string }[] = [
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "pt", label: "Portuguese" },
	{ code: "it", label: "Italian" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "zh", label: "Chinese" },
	{ code: "hi", label: "Hindi" },
	{ code: "ar", label: "Arabic" },
	{ code: "ru", label: "Russian" },
];

function pickMimeType(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	const candidates = [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/mp4",
		"audio/ogg;codecs=opus",
	];
	for (const t of candidates) {
		if (MediaRecorder.isTypeSupported(t)) return t;
	}
	return undefined;
}

export default function WalkieTalkie() {
	const [fromLang, setFromLang] = useState("en");
	const [toLang, setToLang] = useState("es");
	const [recording, setRecording] = useState(false);
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

	const mediaStreamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<BlobPart[]>([]);
	const processingLockRef = useRef(false);
	const processedBlobsRef = useRef(new WeakSet<Blob>());
	const playbackObjectUrlRef = useRef<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const revokePlaybackUrl = useCallback(() => {
		if (playbackObjectUrlRef.current) {
			URL.revokeObjectURL(playbackObjectUrlRef.current);
			playbackObjectUrlRef.current = null;
		}
	}, []);

	const assignPlaybackUrl = useCallback(
		(url: string) => {
			revokePlaybackUrl();
			playbackObjectUrlRef.current = url;
			setPlaybackUrl(url);
		},
		[revokePlaybackUrl],
	);

	useEffect(() => {
		return () => {
			revokePlaybackUrl();
			mediaStreamRef.current?.getTracks().forEach((t) => {
				t.stop();
			});
		};
	}, [revokePlaybackUrl]);

	useEffect(() => {
		if (!playbackUrl) return;
		const el = audioRef.current;
		if (!el) return;
		el.pause();
		el.src = playbackUrl;
		el.load();
		void el.play().catch(() => {
			setError("Could not start playback. Check browser autoplay settings.");
		});
	}, [playbackUrl]);

	const sendRecording = useCallback(
		async (blob: Blob, mimeType: string) => {
			if (processedBlobsRef.current.has(blob)) return;
			if (processingLockRef.current) return;
			processingLockRef.current = true;
			setProcessing(true);
			setError(null);

			const outgoing = new FormData();
			outgoing.append("audio", blob, "recording");
			outgoing.append("from", fromLang);
			outgoing.append("to", toLang);
			outgoing.append("mime", mimeType);

			try {
				const res = await fetch("/api/translate", {
					method: "POST",
					body: outgoing,
				});

				const contentType = res.headers.get("content-type") || "";

				if (!res.ok) {
					let message = `Request failed (${res.status})`;
					if (contentType.includes("application/json")) {
						const data = (await res.json()) as { error?: string };
						if (data.error) message = data.error;
					} else {
						const text = await res.text();
						if (text.trim()) message = text.trim();
					}
					setError(message);
					return;
				}

				if (!contentType.startsWith("audio/")) {
					setError("Translation service did not return audio.");
					return;
				}

				const buffer = await res.arrayBuffer();
				const outMime = contentType.split(";")[0]?.trim() || "audio/mpeg";
				const url = URL.createObjectURL(new Blob([buffer], { type: outMime }));
				assignPlaybackUrl(url);
				processedBlobsRef.current.add(blob);

				setFromLang(toLang);
				setToLang(fromLang);
			} catch {
				setError("Network error while translating. Try again.");
			} finally {
				setProcessing(false);
				processingLockRef.current = false;
			}
		},
		[assignPlaybackUrl, fromLang, toLang],
	);

	const stopRecording = useCallback(() => {
		const rec = mediaRecorderRef.current;
		if (!rec || rec.state === "inactive") return;
		rec.stop();
		setRecording(false);
	}, []);

	const startRecording = useCallback(async () => {
		setError(null);
		if (recording || processing) return;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaStreamRef.current = stream;
			chunksRef.current = [];

			const mimeType = pickMimeType();
			const rec = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			mediaRecorderRef.current = rec;

			rec.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};

			rec.onstop = () => {
				const blob = new Blob(chunksRef.current, { type: rec.mimeType });
				stream.getTracks().forEach((t) => {
					t.stop();
				});
				mediaStreamRef.current = null;
				mediaRecorderRef.current = null;
				if (blob.size === 0) {
					setError("No audio captured. Try again and speak a little longer.");
					return;
				}
				void sendRecording(blob, rec.mimeType);
			};

			rec.start();
			setRecording(true);
		} catch {
			setError("Microphone access was denied or is unavailable.");
		}
	}, [processing, recording, sendRecording]);

	const toggleTalk = () => {
		if (recording) stopRecording();
		else void startRecording();
	};

	return (
		<Card className="border-(--line) bg-(--surface-strong) shadow-sm">
			<CardHeader>
				<CardTitle className="text-(--sea-ink)">
					Walkie-talkie translate
				</CardTitle>
				<CardDescription className="text-(--sea-ink-soft)">
					Click Start to speak and Stop when you are done. The translation plays
					automatically and the languages swap for the next person.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="flex flex-col gap-2">
						<span className="text-sm font-medium text-(--sea-ink)">From</span>
						<select
							className={selectClassName}
							value={fromLang}
							disabled={recording || processing}
							onChange={(e) => setFromLang(e.target.value)}
						>
							{LANGUAGES.map((lang) => (
								<option key={lang.code} value={lang.code}>
									{lang.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-2">
						<span className="text-sm font-medium text-(--sea-ink)">To</span>
						<select
							className={selectClassName}
							value={toLang}
							disabled={recording || processing}
							onChange={(e) => setToLang(e.target.value)}
						>
							{LANGUAGES.map((lang) => (
								<option key={lang.code} value={lang.code}>
									{lang.label}
								</option>
							))}
						</select>
					</label>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						size="lg"
						variant={recording ? "destructive" : "default"}
						className={
							recording
								? "rounded-full px-8"
								: "rounded-full bg-(--lagoon-deep) px-8 text-white hover:bg-(--lagoon)"
						}
						disabled={processing}
						onClick={toggleTalk}
					>
						{recording ? (
							<>
								<SquareIcon className="size-4" />
								Stop
							</>
						) : (
							<>
								<MicIcon className="size-4" />
								Start
							</>
						)}
					</Button>
					{processing ? (
						<span className="text-sm text-(--sea-ink-soft)">Translating…</span>
					) : null}
				</div>

				{error ? (
					<Alert variant="destructive">
						<AlertCircleIcon />
						<AlertTitle>Could not translate</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				<audio
					ref={audioRef}
					className="w-full rounded-lg border border-(--line) bg-black/5 p-2 dark:bg-white/5"
					controls
					src={playbackUrl ?? undefined}
				>
					<track
						kind="captions"
						label="Translation"
						src={PLACEHOLDER_CAPTIONS}
					/>
				</audio>
			</CardContent>
		</Card>
	);
}
