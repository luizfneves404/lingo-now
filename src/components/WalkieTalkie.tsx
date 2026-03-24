import {
	AlertCircleIcon,
	ArrowLeftRightIcon,
	MicIcon,
	SquareIcon,
} from "lucide-react";
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
import { translateSpeech } from "#/server/translate/actions";

const selectClassName =
	"w-full rounded-md border border-[var(--line)] bg-white/90 px-3 py-2 text-sm text-[var(--sea-ink)] dark:bg-[var(--surface)]";

const inputClassName = `${selectClassName} font-mono`;

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

function decodeBase64(data: string): ArrayBuffer {
	if (typeof atob === "function") {
		const binary = atob(data);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		);
	}
	const bytes = Uint8Array.from(Buffer.from(data, "base64"));
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
}

export default function WalkieTalkie() {
	const [fromLang, setFromLang] = useState("en");
	const [toLang, setToLang] = useState("pt");
	const [recording, setRecording] = useState(false);
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
	const [accessPassword, setAccessPassword] = useState("");

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
			outgoing.append("accessPassword", accessPassword);

			try {
				const result = await translateSpeech({ data: outgoing });

				if (!result.ok) {
					setError(result.message);
					return;
				}

				if (!result.contentType.startsWith("audio/")) {
					setError("Translation service did not return audio.");
					return;
				}

				const audioBuffer = decodeBase64(result.audioBase64);
				const url = URL.createObjectURL(
					new Blob([audioBuffer], { type: result.contentType }),
				);
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
		[accessPassword, assignPlaybackUrl, fromLang, toLang],
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

	const swapLanguages = useCallback(() => {
		setFromLang(toLang);
		setToLang(fromLang);
	}, [fromLang, toLang]);

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
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<label className="flex min-w-0 flex-1 flex-col gap-2">
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
					<div className="flex justify-center sm:shrink-0">
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="border-(--line) text-(--sea-ink)"
							disabled={recording || processing}
							aria-label="Swap from and to languages"
							onClick={swapLanguages}
						>
							<ArrowLeftRightIcon />
						</Button>
					</div>
					<label className="flex min-w-0 flex-1 flex-col gap-2">
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

				<label className="flex flex-col gap-2">
					<span className="text-sm font-medium text-(--sea-ink)">
						Access password
					</span>
					<input
						type="password"
						autoComplete="off"
						className={inputClassName}
						value={accessPassword}
						disabled={recording || processing}
						onChange={(e) => setAccessPassword(e.target.value)}
						placeholder="If the server requires TRANSLATE_ACCESS_PASSWORD"
					/>
				</label>

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
