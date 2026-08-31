import { Toast } from "@heroui/react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { AppLayout } from "#/components/app-layout";
import { persistOptions } from "#/lib/persist";
import { queryClient } from "#/lib/query-client";
import { useOnline } from "#/lib/use-online";
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
			// One SVG per theme, chosen by the link's own media query — the only
			// way a favicon follows the browser's theme that every SVG-capable
			// browser honours; an @media inside a single SVG is respected by some
			// and ignored by others. The .ico is the fallback for browsers that
			// take no SVG at all and answers bare /favicon.ico requests, so it
			// carries the middle accent that reads on either ground.
			{
				href: `${base}icon-light.svg`,
				media: "(prefers-color-scheme: light)",
				rel: "icon",
				type: "image/svg+xml",
			},
			{
				href: `${base}icon-dark.svg`,
				media: "(prefers-color-scheme: dark)",
				rel: "icon",
				type: "image/svg+xml",
			},
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
				{/*
				 * Chrome fires beforeinstallprompt the moment it judges the page
				 * installable, and on a return visit — where the engagement it waits
				 * for was satisfied on some earlier one — that can land before the
				 * bundle has even parsed. The event is offered once and never again,
				 * so a listener that arrives with the app arrives too late. This one
				 * is in the document itself: it parks the event on `window`, and
				 * useInstall picks it up from there whenever it does mount.
				 */}
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: a literal in the shell, the only listener early enough to catch the event
					dangerouslySetInnerHTML={{
						__html:
							'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__poolLinkInstall=e});addEventListener("appinstalled",function(){window.__poolLinkInstall=null})',
					}}
				/>
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
	const online = useOnline();
	if (online) return null;
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
