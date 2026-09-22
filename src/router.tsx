import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		basepath: import.meta.env.BASE_URL,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	// The router sets history.scrollRestoration to "manual" as it is built, and
	// that switches off the browser's own pre-paint restore — which is what
	// Safari's swipe-back preview is drawn from, so in the home-screen app the
	// gesture peeled back onto a blank or mis-scrolled frame. The router's own
	// restore runs after paint and does not depend on manual mode, so both can
	// run. Upstream removes the assignment in TanStack/router#8347; until that
	// ships, put the browser default back once the router has taken it away.
	if (!router.isServer) history.scrollRestoration = "auto";

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
