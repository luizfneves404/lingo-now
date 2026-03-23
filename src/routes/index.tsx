import { createFileRoute } from "@tanstack/react-router";
import WalkieTalkie from "#/components/WalkieTalkie";

export const Route = createFileRoute("/")({ component: App });

function App() {
	return (
		<main className="page-wrap px-4 pb-8 pt-8">
			<section className="island-shell rounded-3xl px-6 py-8 sm:px-8 sm:py-10">
				<p className="island-kicker mb-3">Lingo Now</p>
				<h1 className="mb-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-(--sea-ink) sm:text-5xl">
					Digital walkie-talkie translation
				</h1>
				<p className="m-0 max-w-2xl text-base text-(--sea-ink-soft) sm:text-lg">
					Record with your browser microphone, send audio to your translation
					service, hear the reply, and flip languages for the other person.
				</p>
			</section>

			<section className="mx-auto mt-8 max-w-2xl">
				<WalkieTalkie />
			</section>
		</main>
	);
}
