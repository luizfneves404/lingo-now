export default function Footer() {
	const year = new Date().getFullYear();

	return (
		<footer className="mt-20 border-t border-(--line) px-4 pb-14 pt-10 text-(--sea-ink-soft)">
			<div className="page-wrap flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:text-left">
				<p className="m-0 text-sm">&copy; {year} Lingo Now</p>
			</div>
		</footer>
	);
}
