import { createFileRoute } from "@tanstack/react-router";
import WalkieTalkie from "#/components/WalkieTalkie";

export const Route = createFileRoute("/")({ component: App });

function App() {
	return (
		<main className="page-wrap px-4 pb-8 pt-14">
			<section className="island-shell rise-in relative overflow-hidden rounded-4xl px-6 py-10 sm:px-10 sm:py-14">
				<div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
				<div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
				<p className="island-kicker mb-3">Lingo Now</p>
				<h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-(--sea-ink) sm:text-6xl">
					Digital walkie-talkie translation
				</h1>
				<p className="mb-8 max-w-2xl text-base text-(--sea-ink-soft) sm:text-lg">
					Record with your browser microphone, send audio to your translation
					service, hear the reply, and flip languages for the other person.
				</p>
			</section>

			<section
				className="mx-auto mt-8 max-w-2xl rise-in"
				style={{ animationDelay: "80ms" }}
			>
				<WalkieTalkie />
			</section>
		</main>
	);
}
