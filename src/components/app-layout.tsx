import { Chip } from "@heroui/react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
	MapPinHouse,
	Settings,
	ThermometerSnowflake,
	ThermometerSun,
	Waves,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppHeader, IconBtn } from "#/components/app-header";
import { BottomNav } from "#/components/bottom-nav";
import { InstallPrompt } from "#/components/install-prompt";
import { Loading } from "#/components/loading";
import { ThemeToggle } from "#/components/theme-toggle";
import { isCelsius, timeAgo } from "#/lib/format";
import { STALE_MS, usePanel, useSession, useSystems } from "#/lib/queries";

/**
 * Page chrome for every route. The header lives here so /login gets the
 * wordmark too; its actions are session-gated, since none of them mean
 * anything to a signed-out visitor.
 *
 * The queries below share keys with the routes', so React Query serves them
 * from cache rather than issuing a second round of requests.
 */
/** `/systems/<serial>` and anything under it. */
const SYSTEM_PATH = /^\/systems\/([^/]+)/;

export function AppLayout({ children }: { children: React.ReactNode }) {
	const session = useSession();
	const signedIn = Boolean(session.data);
	const systems = useSystems(signedIn);
	const router = useRouter();
	const navigate = useNavigate();

	const pathname = useRouterState({ select: (st) => st.location.pathname });

	// Present only inside /systems/$serial; undefined on the list and elsewhere.
	// Read off the path rather than from useParams: the two update on separate
	// subscriptions, and a render where the path had moved but the params had
	// not left this thinking it was on no page at all — long enough to paint
	// the list's header on the way into a system.
	const serial = SYSTEM_PATH.exec(pathname)?.[1];
	const system = systems.data?.find((s) => s.serial === serial);
	const snap = usePanel(serial);

	// On a system the chip tracks that system's live snapshot; on the list it
	// tracks the account's system list, which is the only thing being fetched.
	const source = serial ? snap : systems;
	// Air belongs to neither body, so the hero has no natural place for it
	// once that card is about swapping between pool and spa.
	const air = snap.data?.devices.find((d) => d.name === "air_temp");
	// `unit` is only "°" — the scale itself is on the raw home payload, and the
	// warm/cold threshold has to follow it.
	const celsius = isCelsius(snap.data?.raw);
	const airValue = Number(air?.value);
	const AirIcon =
		Number.isFinite(airValue) && airValue >= (celsius ? 21 : 70)
			? ThermometerSun
			: ThermometerSnowflake;
	// Always ticking, because the cutoff below has to be noticed even when
	// nothing else re-renders. Cheap: `children` keeps its element identity,
	// so the tick re-renders the chrome alone.
	const now = useSecondTick();
	// The chip has one rule: Live until the data is STALE_MS old. Not query
	// staleness — a mutation's invalidate marks queries stale mid-refetch and
	// a single failed poll drops isSuccess, and both painted an age over data
	// seconds old. Age is the only thing the chip claims, so age decides.
	const live =
		source.dataUpdatedAt > 0 && now - source.dataUpdatedAt < STALE_MS;
	const age = source.dataUpdatedAt
		? timeAgo(source.dataUpdatedAt, now)
		: "Stale";

	// Settings and diagnostics live under /systems/$serial too, but they are not
	// tab destinations — the bar would show Pool selected while on neither.
	const leaf = pathname.split("/").pop() ?? "";
	const onTab =
		Boolean(serial) && leaf !== "settings" && leaf !== "diagnostics";
	// Nothing to navigate to when you are already there.
	const onSettings = leaf === "settings";
	// Sub-pages are titled by what they are, not by which system they belong to.
	const pageTitle =
		leaf === "settings"
			? "Settings"
			: leaf === "diagnostics"
				? "Diagnostics"
				: null;
	// Live state needs a subject: a system's snapshot, or the account's system
	// list. Account-level sub-pages have neither, so they show neither control.
	const hasLive = Boolean(serial) || pathname === "/";
	// Sign-in carries its own branding inside the card; a header above it would
	// just repeat the wordmark.
	const onLogin = pathname === "/login";

	// Sub-page titles come from the URL, so they are right on first paint.
	// Everything else waits rather than flashing a title it is about to replace:
	// the session resolves from IndexedDB, and a system's name from the network.
	const title =
		pageTitle ??
		(!signedIn ? "Pool Link" : serial ? (system?.name ?? "") : "My Systems");

	// Any first load is a bare spinner — no header, no chrome around it. What
	// matters is whether there is anything to draw, not whether a fetch is in
	// flight: coming back to a page whose data is still cached should show it,
	// and refetch behind the spinner-free screen.
	const needsSystems = pathname === "/" || Boolean(serial);
	// A single system means the list is a page with one link on it, so the route
	// sends them straight through. Counting that as loading keeps the header and
	// the list itself from painting for the instant before the redirect lands.
	const only =
		pathname === "/" && signedIn && systems.data?.length === 1
			? systems.data[0].serial
			: undefined;
	const passingThrough = Boolean(only);

	// The redirect lives here rather than in the route because the loading gate
	// below returns instead of rendering `children` — a route that never mounts
	// cannot navigate, and the spinner would wait on itself.
	useEffect(() => {
		if (only) {
			navigate({
				params: { serial: only },
				replace: true,
				to: "/systems/$serial",
			});
		}
	}, [only, navigate]);
	const loading =
		session.isPending ||
		(signedIn && needsSystems && systems.isPending) ||
		passingThrough ||
		// Signed-in only: signed out, the panel queries are disabled and this
		// would never resolve — the spinner would stand in front of the route
		// whose job is to redirect to /login, which cannot run unmounted.
		(signedIn && Boolean(serial) && !snap.data);

	// /sign-out renders its own spinner, but it has to actually mount to run the
	// mutation — so it bypasses the chrome without bypassing `children`.
	if (leaf === "sign-out") return <>{children}</>;

	if (loading) return <Loading />;

	return (
		<div
			// Landscape puts the notch and the home indicator on the sides, so the
			// horizontal padding is a floor rather than a fixed value — 1rem when
			// there is no inset, the inset when it is larger.
			className={`mx-auto flex min-h-svh w-full max-w-6xl animate-in flex-col ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] duration-200 fade-in ${
				onTab
					? "pb-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)]"
					: "pb-6"
			}`}
		>
			{/* Both sides of the sign-in card, each with a dismissal of its own —
			    see InstallPrompt. Past the loading gate either way, so it never
			    lands on a spinner. */}
			<InstallPrompt scope={signedIn ? "in" : "out"} />

			{onLogin ? null : (
				<AppHeader
					Icon={serial || !signedIn ? Waves : MapPinHouse}
					onBack={pageTitle ? () => router.history.back() : undefined}
					params={serial ? { serial } : undefined}
					to={!signedIn ? undefined : serial ? "/systems/$serial" : "/"}
					title={title}
				>
					{signedIn ? (
						<>
							{/* Sub-pages keep the header quiet: settings and diagnostics
							    are about the system, not the water, so the readings and
							    their controls sit those pages out. */}
							{!pageTitle && serial && air?.value ? (
								<span className="me-1 flex items-center gap-1.5 text-xs text-muted">
									<AirIcon className="size-4 text-accent" />
									<span className="tabular-nums">
										{air.value}
										{air.unit ?? "°"}
									</span>
								</span>
							) : null}
							{hasLive && !pageTitle ? (
								<Chip color={live ? "success" : "warning"} variant="soft">
									{live ? "Live" : age}
								</Chip>
							) : null}
							{/* size-5 glyphs leave 8px of padding inside each 36px button, so
						    a smaller gap here still reads level with the chip's spacing. */}
							<div className="flex items-center space-x-0.5">
								{pageTitle ? null : <ThemeToggle />}
								{/* Two settings pages: a system's adds renaming, the account's
							    does not. */}
								{onSettings ? null : serial ? (
									<IconBtn
										label="Settings"
										params={{ serial }}
										to="/systems/$serial/settings"
									>
										<Settings className="size-5" />
									</IconBtn>
								) : (
									<IconBtn label="Settings" to="/settings">
										<Settings className="size-5" />
									</IconBtn>
								)}
							</div>
						</>
					) : null}
				</AppHeader>
			)}

			{children}

			{onTab && serial ? <BottomNav serial={serial} /> : null}
		</div>
	);
}

/** Re-render once a second, so the chip notices its cutoff and its age. */
function useSecondTick() {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(id);
	}, []);

	return now;
}
