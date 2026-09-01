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

/**
 * What this page is allowed to load, and where it may talk.
 *
 * The reason it is worth having is in IndexedDB: a refresh token that renews
 * itself for thirty days and outlives signing out, sitting in plain JSON on the
 * origin. Nothing about that is comfortable, and the architecture is what makes
 * it so — the pool's cloud is spoken to straight from the browser, so the
 * credential has to live where the browser can reach it. Given that, the useful
 * question is not how to hide it but how much a script that finds it could do
 * with it, and `connect-src` is the answer: this origin and the three Zodiac
 * hosts the app genuinely speaks to, and nowhere for a token to be posted to.
 *
 * `script-src` keeps 'unsafe-inline', which is the honest compromise here and
 * worth stating plainly rather than dressing up. Two inline scripts run in this
 * shell — the install-prompt listener below, and the theme script next-themes
 * writes to set the class before first paint — and the alternative to allowing
 * them is a nonce, which needs a server to mint one per response. This app is
 * prerendered to static files on GitHub Pages; there is no such server. Hashes
 * would cover our own script and break silently the day next-themes changes
 * theirs. So inline stays allowed, and what the policy still buys is real: no
 * remote script may be loaded, no <base> may be rewritten, no plugin may be
 * embedded, and nothing may be sent anywhere but the hosts named below.
 *
 * Production only. Vite's dev server needs eval and a websocket for HMR, and a
 * policy that forbade them would make `bun run dev` useless.
 */
const CSP = [
	"default-src 'self'",
	"base-uri 'none'",
	"object-src 'none'",
	"form-action 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' https://fonts.gstatic.com",
	"img-src 'self' data:",
	"manifest-src 'self'",
	[
		"connect-src 'self'",
		// Login and refresh.
		"https://prod.zodiac-io.com",
		// Telemetry and every command.
		"https://p-api.iaqualink.net",
		// The account and its system list.
		"https://prm.iaqualink.net",
	].join(" "),
].join("; ");

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
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
				{/* Before HeadContent, so the policy is in force by the time the
				    parser reaches the font link and the two inline scripts — a meta
				    CSP governs only what follows it. */}
				{import.meta.env.PROD ? (
					<meta content={CSP} httpEquiv="Content-Security-Policy" />
				) : null}
				{/* The WebTouch tab is opened with the idToken in its URL, and a
				    referrer would hand that same URL to anything the panel's own web
				    UI goes on to load. Nothing in this app needs to be introduced by
				    where it came from. */}
				<meta content="no-referrer" name="referrer" />
				{/* Literal rather than entries in head()'s meta array: that array is
				    deduplicated by `name`, which ignores `media` — so of two
				    theme-colors only the last survived, and dark mode was left with
				    none at all. */}
				<meta
					content="#030608"
					media="(prefers-color-scheme: dark)"
					name="theme-color"
				/>
				<meta
					content="#EFF7FA"
					media="(prefers-color-scheme: light)"
					name="theme-color"
				/>
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
