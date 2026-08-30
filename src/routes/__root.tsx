import { Toast, toast } from "@heroui/react";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { AppLayout } from "#/components/app-layout";
import { AqualinkError, errorMessage } from "#/lib/aqualink/types";
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
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						// Retry count is the library default. Only the backoff cap is
						// ours: theirs tops out at 30s, six times the poll interval,
						// and a query will not start its next scheduled poll while a
						// retry is still pending — so a blip could hold the screen on
						// half-minute-old data when polling again would have been
						// fresher. Capped near one interval, the poll is the retry.
						retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
						refetchOnWindowFocus: false,
						staleTime: 5_000,
					},
				},
				// Every query and mutation reports through here, so nothing needs a
				// per-call error handler.
				queryCache: new QueryCache({
					onError: (error, query) => {
						// A poll that fails behind data we already hold changes nothing
						// on screen and the next one will likely succeed. The header's
						// updated-at is the honest signal for that, not a toast.
						if (query.state.data !== undefined) return;
						toastError(error);
					},
				}),
				mutationCache: new MutationCache({ onError: toastError }),
			}),
	);

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
					<QueryClientProvider client={client}>
						<AppLayout>{children}</AppLayout>
						<OfflineBanner />
					</QueryClientProvider>
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
let lastToast = { message: "", at: 0 };
const TOAST_DEDUPE_MS = 10_000;

function toastError(error: unknown) {
	// 401s are the signed-out path, not a fault: an in-flight poll landing after
	// sign-out, or an expired session. Both redirect to /login, which says it
	// better than a toast would.
	if (error instanceof AqualinkError && error.status === 401) return;

	const message = errorMessage(error);
	const now = Date.now();
	if (message === lastToast.message && now - lastToast.at < TOAST_DEDUPE_MS)
		return;
	lastToast = { message, at: now };
	toast.danger(message);
}
