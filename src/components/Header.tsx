import { Link } from "@tanstack/react-router";

export default function Header() {
	return (
		<header className="sticky top-0 z-50 border-b border-(--line) bg-(--header-bg) px-4">
			<nav className="page-wrap py-3 sm:py-4">
				<h2 className="m-0 text-base font-semibold tracking-tight">
					<Link
						to="/"
						className="inline-flex items-center gap-2 rounded-full border border-(--chip-line) bg-(--chip-bg) px-3 py-1.5 text-sm text-(--sea-ink) no-underline sm:px-4 sm:py-2"
					>
						<span className="h-2 w-2 rounded-full bg-(--lagoon)" />
						Lingo Now
					</Link>
				</h2>
			</nav>
		</header>
	);
}
