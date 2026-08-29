import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import appCss from "../styles.css?url";

/** "/" locally, "/<repo>/" on GitHub Pages. Ends with a slash either way. */
const base = import.meta.env.BASE_URL;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				name: "theme-color",
				content: "#071018",
				media: "(prefers-color-scheme: dark)",
			},
			{
				name: "theme-color",
				content: "#f4fbff",
				media: "(prefers-color-scheme: light)",
			},
			{
				name: "description",
				content:
					"A fast, offline-capable control surface for your iAqualink pool.",
			},
			{ name: "mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent",
			},
			{ title: "Pool Link" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: `${base}manifest.webmanifest` },
			{ rel: "icon", type: "image/svg+xml", href: `${base}icon.svg` },
			{ rel: "apple-touch-icon", href: `${base}icons/icon-192.png` },
		],
		scriptAsync: [{ src: `${base}theme-init.js` }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
				},
			}),
	);

	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<QueryClientProvider client={client}>
					{children}
					<OfflineBanner />
				</QueryClientProvider>
				<Scripts />
			</body>
		</html>
	);
}

function OfflineBanner() {
	const [offline, setOffline] = useState(false);
	useEffect(() => {
		const on = () => setOffline(true);
		const off = () => setOffline(false);
		setOffline(!navigator.onLine);
		addEventListener("offline", on);
		addEventListener("online", off);
		return () => {
			removeEventListener("offline", on);
			removeEventListener("online", off);
		};
	}, []);
	if (!offline) return null;
	return (
		<div className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-400/30 bg-amber-950/90 px-4 py-2.5 text-center text-xs font-medium text-amber-200 backdrop-blur-xl">
			No internet — showing last known state. The panel keeps running its own
			schedule.
		</div>
	);
}
