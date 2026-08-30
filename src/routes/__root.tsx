import { Toast } from "@heroui/react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { AppLayout } from "#/components/app-layout";
import { persistOptions } from "#/lib/persist";
import { queryClient } from "#/lib/query-client";
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
				content: "#030608",
				media: "(prefers-color-scheme: dark)",
			},
			{
				name: "theme-color",
				content: "#EFF7FA",
				media: "(prefers-color-scheme: light)",
			},
			{
				name: "description",
				content: "A fast control surface for your iAqualink pool and spa.",
			},
			{ name: "mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-title", content: "Pool Link" },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent",
			},
			{ title: "Pool Link" },
		],
		links: [
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				crossOrigin: "anonymous",
				href: "https://fonts.gstatic.com",
				rel: "preconnect",
			},
			{
				href: "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
				rel: "stylesheet",
			},
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: `${base}manifest.webmanifest` },
			// Browsers that understand SVG favicons take the first; the .ico is
			// the fallback and also answers bare /favicon.ico requests.
			{ rel: "icon", type: "image/svg+xml", href: `${base}icon.svg` },
			{ rel: "icon", sizes: "32x32", href: `${base}favicon.ico` },
			// iOS ignores sizes other than 180 and applies its own squircle mask.
			{
				rel: "apple-touch-icon",
				sizes: "180x180",
				href: `${base}icons/apple-touch-icon.png`,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// next-themes swaps the class on <html> after mount, which is exactly the
		// kind of mismatch suppressHydrationWarning exists for.
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<Toast.Provider />
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<PersistQueryClientProvider
						client={queryClient}
						persistOptions={persistOptions}
					>
						<AppLayout>{children}</AppLayout>
						<OfflineBanner />
					</PersistQueryClientProvider>
				</ThemeProvider>
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
		<div className="fixed inset-x-0 bottom-0 z-50 border-t border-warning/30 bg-warning/15 px-4 py-2.5 text-center text-xs font-medium text-warning backdrop-blur-xl">
			No internet — showing last known state. The panel keeps running its own
			schedule.
		</div>
	);
}

/**
 * The snapshot query polls every 5s, so an unreachable pool would otherwise
 * raise the same toast twelve times a minute. Collapse repeats of the same
 * message inside a short window.
 */
