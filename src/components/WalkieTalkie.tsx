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

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "recording" | "processing" | "playing" | "done";

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "pt", label: "Portuguese" },
	{ code: "it", label: "Italian" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "zh", label: "Chinese" },
] as const;

const selectClassName =
	"w-full rounded-md border border-[var(--line)] bg-white/90 px-3 py-2 text-sm text-[var(--sea-ink)] dark:bg-[var(--surface)]";

const inputClassName = `${selectClassName} font-mono`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickMimeType(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	for (const t of [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/mp4",
		"audio/ogg;codecs=opus",
	]) {
		if (MediaRecorder.isTypeSupported(t)) return t;
	}
	return undefined;
}

async function* readStream<T>(
	stream: ReadableStream<T>,
): AsyncGenerator<T, void, undefined> {
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

function pcm16leToAudioBuffer(
	ctx: BaseAudioContext,
	pcm: Uint8Array,
): AudioBuffer {
	const frameCount = Math.floor(pcm.byteLength / 2);
	const buf = ctx.createBuffer(1, frameCount, ctx.sampleRate);
	const ch = buf.getChannelData(0);
	const view = new DataView(pcm.buffer, pcm.byteOffset, frameCount * 2);
	for (let i = 0; i < frameCount; i++) {
		ch[i] = view.getInt16(i * 2, true) / 32768;
	}
	return buf;
}

function getTranslateDevEchoOverride(): string | null {
	if (typeof window === "undefined") return null;
	const value = new URLSearchParams(window.location.search).get(
		"translateDevEcho",
	);
	if (value === "1" || value === "0" || value === "true" || value === "false") {
		return value;
	}
	return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WalkieTalkie() {
	const [fromLang, setFromLang] = useState("en");
	const [toLang, setToLang] = useState("pt");
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [accessPassword, setAccessPassword] = useState("");
	const [transcriptText, setTranscriptText] = useState("");
	const [translationText, setTranslationText] = useState("");

	// refs that don't need to trigger renders
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<BlobPart[]>([]);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const inFlightRef = useRef(false);

	// Derived test-facing value: map phase → playback-status string the test expects
	const playbackStatus =
		phase === "playing" ? "playing" : phase === "done" ? "done" : "idle";

	// Clean up audio context on unmount
	useEffect(() => {
		return () => {
			void audioCtxRef.current?.close();
			mediaStreamRef.current?.getTracks().forEach((t) => {
				t.stop();
				void null;
			});
		};
	}, []);

	const closeAudioCtx = useCallback(async () => {
		const ctx = audioCtxRef.current;
		audioCtxRef.current = null;
		if (ctx && ctx.state !== "closed") {
			try {
				await ctx.close();
			} catch {
				/* ignore */
			}
		}
	}, []);

	// ── Send recorded blob through translation pipeline ──────────────────────

	const sendRecording = useCallback(
		async (blob: Blob, mimeType: string) => {
			if (inFlightRef.current) return;
			inFlightRef.current = true;
			setPhase("processing");
			setError(null);
			await closeAudioCtx();

			const form = new FormData();
			form.append("audio", blob, "recording");
			form.append("from", fromLang);
			form.append("to", toLang);
			form.append("mime", mimeType);
			form.append("accessPassword", accessPassword);
			const translateDevEcho = getTranslateDevEchoOverride();
			if (translateDevEcho) {
				form.append("translateDevEcho", translateDevEcho);
			}

			try {
				const stream = await translateSpeech({ data: form });
				let ctx: AudioContext | null = null;
				let nextPlayTime = 0;

				for await (const chunk of readStream(stream)) {
					console.log("Received chunk kind:", chunk.kind);
					if (chunk.kind === "transcript") {
						setTranscriptText(chunk.text);
					} else if (chunk.kind === "translation") {
						setTranslationText(chunk.text);
					} else if (chunk.kind === "ready") {
						ctx = new AudioContext({ sampleRate: chunk.format.sampleRate });
						audioCtxRef.current = ctx;
						nextPlayTime = ctx.currentTime + 0.05;
						setPhase("playing");
					} else if (chunk.kind === "audio") {
						if (!ctx) {
							setError("Translation stream missing format header.");
							break;
						}
						const ab = pcm16leToAudioBuffer(ctx, chunk.pcm);
						const src = ctx.createBufferSource();
						src.buffer = ab;
						src.connect(ctx.destination);
						const startAt = Math.max(nextPlayTime, ctx.currentTime);
						src.start(startAt);
						nextPlayTime = startAt + ab.duration;
					} else if (chunk.kind === "error") {
						setError(chunk.message);
						break;
					} else if (chunk.kind === "complete" && ctx) {
						console.log("Waiting for audio to finish...");
						const waitMs = Math.max(
							0,
							(nextPlayTime - ctx.currentTime) * 1000 + 80,
						);
						await new Promise((r) => setTimeout(r, waitMs));
						break;
					}
				}

				console.log("Stream loop exited!");

				await closeAudioCtx();

				if (!error) {
					// Swap languages for next speaker
					setFromLang(toLang);
					setToLang(fromLang);
					setPhase("done");
				} else {
					setPhase("idle");
				}
			} catch {
				await closeAudioCtx();
				setError("Network error while translating. Try again.");
				setPhase("idle");
			} finally {
				inFlightRef.current = false;
			}
		},
		[accessPassword, closeAudioCtx, error, fromLang, toLang],
	);

	// ── Recording controls ───────────────────────────────────────────────────

	const startRecording = useCallback(async () => {
		if (phase !== "idle" && phase !== "done") return;
		setError(null);
		setTranscriptText("");
		setTranslationText("");

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
				stream.getTracks().forEach((t) => {
					t.stop();
					void null;
				});
				mediaStreamRef.current = null;
				mediaRecorderRef.current = null;
				const blob = new Blob(chunksRef.current, { type: rec.mimeType });
				if (blob.size === 0) {
					setError("No audio captured. Speak a little longer and try again.");
					setPhase("idle");
					return;
				}
				void sendRecording(blob, rec.mimeType);
			};

			rec.start();
			setPhase("recording");
		} catch {
			setError("Microphone access was denied or is unavailable.");
		}
	}, [phase, sendRecording]);

	const stopRecording = useCallback(() => {
		const rec = mediaRecorderRef.current;
		if (!rec || rec.state === "inactive") return;
		rec.stop();
	}, []);

	const toggleTalk = () => {
		if (phase === "recording") stopRecording();
		else void startRecording();
	};

	const swapLanguages = () => {
		setFromLang(toLang);
		setToLang(fromLang);
	};

	const isBusy = phase === "processing" || phase === "playing";

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<Card className="border-(--line) bg-(--surface-strong) shadow-sm">
			<CardHeader>
				<CardTitle className="text-(--sea-ink)">How to</CardTitle>
				<CardDescription className="text-(--sea-ink-soft)">
					Click Start to speak and Stop when you are done. The translation plays
					through your speakers as it arrives, and the languages swap for the
					next person.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{/* Access password */}
				<label className="flex flex-col gap-2">
					<span className="text-sm font-medium text-(--sea-ink)">
						Access password
					</span>
					<input
						type="password"
						autoComplete="off"
						className={inputClassName}
						value={accessPassword}
						disabled={isBusy || phase === "recording"}
						onChange={(e) => setAccessPassword(e.target.value)}
						placeholder="If the server requires TRANSLATE_ACCESS_PASSWORD"
					/>
				</label>

				{/* Language selectors */}
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<label className="flex min-w-0 flex-1 flex-col gap-2">
						<span className="text-sm font-medium text-(--sea-ink)">From</span>
						<select
							className={selectClassName}
							value={fromLang}
							disabled={isBusy || phase === "recording"}
							onChange={(e) => setFromLang(e.target.value)}
						>
							{LANGUAGES.map((l) => (
								<option key={l.code} value={l.code}>
									{l.label}
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
							disabled={isBusy || phase === "recording"}
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
							disabled={isBusy || phase === "recording"}
							onChange={(e) => setToLang(e.target.value)}
						>
							{LANGUAGES.map((l) => (
								<option key={l.code} value={l.code}>
									{l.label}
								</option>
							))}
						</select>
					</label>
				</div>

				{/* Hidden test handles */}
				<div className="hidden" aria-hidden>
					<span data-testid="playback-status">{playbackStatus}</span>
				</div>

				{/* Controls */}
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						size="lg"
						variant={phase === "recording" ? "destructive" : "default"}
						className={
							phase === "recording"
								? "rounded-full px-8"
								: "rounded-full bg-(--lagoon-deep) px-8 text-white hover:bg-(--lagoon)"
						}
						disabled={isBusy}
						onClick={toggleTalk}
					>
						{phase === "recording" ? (
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
					{phase === "processing" && (
						<span className="text-sm text-(--sea-ink-soft)">Translating…</span>
					)}
					{phase === "playing" && (
						<span className="text-sm text-(--sea-ink-soft)">Playing…</span>
					)}
				</div>

				{/* Transcript / translation */}
				{(transcriptText || translationText) && (
					<div className="flex flex-col gap-3 rounded-lg border border-(--line) bg-white/60 p-4 text-sm dark:bg-(--surface)">
						<div>
							<span className="font-medium text-(--sea-ink)">
								Transcription
							</span>
							<p
								className="mt-1 text-(--sea-ink-soft)"
								data-testid="transcript-text"
							>
								{transcriptText || "—"}
							</p>
						</div>
						<div>
							<span className="font-medium text-(--sea-ink)">Translation</span>
							<p
								className="mt-1 text-(--sea-ink-soft)"
								data-testid="translation-text"
							>
								{translationText || "—"}
							</p>
						</div>
					</div>
				)}

				{/* Error */}
				{error && (
					<Alert variant="destructive">
						<AlertCircleIcon />
						<AlertTitle>Could not translate</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}
