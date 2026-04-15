import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<div className="font-sans antialiased wrap-anywhere selection:bg-[rgba(79,184,178,0.24)]">
			<Outlet />
		</div>
	);
}
