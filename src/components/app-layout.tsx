import { Chip } from "@heroui/react";
import { useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { MapPinHouse, RefreshCw, Settings, Waves } from "lucide-react";
import { useEffect, useState } from "react";
import { AppHeader, IconBtn } from "#/components/app-header";
import { BottomNav } from "#/components/bottom-nav";
import { Loading } from "#/components/loading";
import { timeAgo } from "#/lib/format";
import { useSession, useSnapshot, useSystems } from "#/lib/queries";

/**
 * Page chrome for every route. The header lives here so /login gets the
 * wordmark too; its actions are session-gated, since none of them mean
 * anything to a signed-out visitor.
 *
 * The queries below share keys with the routes', so React Query serves them
 * from cache rather than issuing a second round of requests.
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
	const session = useSession();
	const signedIn = Boolean(session.data);
	const systems = useSystems(signedIn);
	const router = useRouter();

	// Present only inside /systems/$serial; undefined on the list and elsewhere.
	const { serial } = useParams({ strict: false });
	const system = systems.data?.find((s) => s.serial === serial);
	const snap = useSnapshot(serial);

	// On a system the chip tracks that system's live snapshot; on the list it
	// tracks the account's system list, which is the only thing being fetched.
	const source = serial ? snap : systems;
	const live = source.isSuccess && !source.isStale;
	// Only tick while stale — no reason to re-render the whole layout every
	// second when the label is the constant "Live".
	const now = useSecondTick(!live);
	const age = source.dataUpdatedAt
		? timeAgo(source.dataUpdatedAt, now)
		: "Stale";

	// Settings and diagnostics live under /systems/$serial too, but they are not
	// tab destinations — the bar would show Pool selected while on neither.
	const pathname = useRouterState({ select: (st) => st.location.pathname });
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

	// Any first load is a bare spinner — no header, no chrome around it. Both
	// queries report pending while disabled, so each is gated on actually being
	// needed here: the list and a system page need `systems`, only a system page
	// needs its snapshot.
	const needsSystems = pathname === "/" || Boolean(serial);
	const loading =
		session.isPending ||
		(signedIn && needsSystems && systems.isPending) ||
		(Boolean(serial) && snap.isPending);

	// /sign-out renders its own spinner, but it has to actually mount to run the
	// mutation — so it bypasses the chrome without bypassing `children`.
	if (leaf === "sign-out") return <>{children}</>;

	if (loading) return <Loading />;

	return (
		<div
			className={`mx-auto flex min-h-svh w-full max-w-md animate-in flex-col px-4 pt-[max(0.5rem,env(safe-area-inset-top))] duration-200 fade-in ${
				onTab
					? "pb-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)]"
					: "pb-6"
			}`}
		>
			{onLogin ? null : (
				<AppHeader
					Icon={signedIn && !serial ? MapPinHouse : Waves}
					onBack={pageTitle ? () => router.history.back() : undefined}
					title={title}
				>
					{signedIn ? (
						<>
							{hasLive ? (
								<Chip color={live ? "success" : "warning"} variant="soft">
									{live ? "Live" : age}
								</Chip>
							) : null}
							{/* size-5 glyphs leave 8px of padding inside each 36px button, so
						    a smaller gap here still reads level with the chip's spacing. */}
							<div className="flex items-center space-x-0.5">
								{hasLive ? (
									<IconBtn
										label="Refresh"
										onPress={() => source.refetch()}
										disabled={source.isFetching}
									>
										<RefreshCw
											className={`size-4.5 ${source.isFetching ? "animate-spin" : ""}`}
										/>
									</IconBtn>
								) : null}
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

/** Re-render once a second, but only while the caller needs a moving value. */
function useSecondTick(enabled: boolean) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!enabled) return;
		// Resync on enable; `now` may be from whenever the ticker last stopped.
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(id);
	}, [enabled]);

	return now;
}
