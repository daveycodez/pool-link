import { Chip } from "@heroui/react";
import { useRouterState } from "@tanstack/react-router";
import { RefreshCw, Settings } from "lucide-react";
import { AppHeader, IconBtn } from "#/components/app-header";
import { BottomNav, TABBED_ROUTES } from "#/components/bottom-nav";
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
	const system = systems.data?.[0];
	const snap = useSnapshot(system?.serial);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const live = snap.isSuccess && !snap.isStale;

	// Only the tabbed routes need clearance for the floating nav; /settings,
	// /diagnostics and /login would otherwise get dead space at the bottom.
	const tabbed = signedIn && TABBED_ROUTES.includes(pathname);

	return (
		<div
			className={`mx-auto w-full max-w-md px-4 pt-[max(0.5rem,env(safe-area-inset-top))] ${
				tabbed
					? "pb-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)]"
					: "pb-6"
			}`}
		>
			<AppHeader title={signedIn ? system?.name : undefined}>
				{signedIn ? (
					<>
						<Chip color={live ? "success" : "warning"} size="sm" variant="soft">
							{live ? "Live" : "Stale"}
						</Chip>
						<IconBtn
							label="Refresh"
							onPress={() => snap.refetch()}
							disabled={snap.isFetching}
						>
							<RefreshCw
								className={`size-4 ${snap.isFetching ? "animate-spin" : ""}`}
							/>
						</IconBtn>
						<IconBtn label="Settings" to="/settings">
							<Settings className="size-4" />
						</IconBtn>
					</>
				) : null}
			</AppHeader>

			{children}

			{tabbed ? <BottomNav /> : null}
		</div>
	);
}
