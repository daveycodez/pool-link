import { Tabs } from "@heroui/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Calendar, House, Lightbulb } from "lucide-react";

/**
 * Three destinations, which is one more than this bar could hold laid out the
 * way it used to be.
 *
 * The old note here guessed that a third tab would only overflow once labels
 * were translated. Measured, it overflows in English. A tab is `h-8 px-4
 * text-sm` plus this file's own `gap-2` and a `size-4` icon, which is about 96,
 * 134 and 128 points for Home, Equipment and Schedules — some 366 against the
 * 288 a 320-point phone leaves after the layout's padding. Two tabs came to 238
 * and fit comfortably, which is why the limit went unnoticed. `Tabs.List` is
 * `w-max min-w-full`, so the overspill becomes scroll chevrons, and a primary
 * destination behind a chevron is not a destination.
 *
 * So the labels move under the icons on small screens, which is the shape a
 * phone's tab bar has anyway: each tab then costs its label's width rather than
 * its label plus an icon plus the gap between them, about 270 points for all
 * three. That leaves room for a longer word than any of these — "Configuración"
 * included — where the inline arrangement had none. Wide screens keep the
 * inline form, where there was never a shortage of room.
 *
 * Settings is still not here. It stays behind the header gear because it is not
 * a place anyone goes to watch a pool, not because the bar has no space.
 */
const TABS = [
	{ to: "/systems/$serial", label: "Home", Icon: House },
	{ to: "/systems/$serial/equipment", label: "Equipment", Icon: Lightbulb },
	{ to: "/systems/$serial/schedules", label: "Schedules", Icon: Calendar },
] as const;

export function BottomNav({ serial }: { serial: string }) {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// Match on the resolved path so the tab tracks the URL, not a local state.
	// The last segment names the destination, except on Home, where it is the
	// serial itself — so Home is the fallback rather than something to match,
	// and a sub-page nobody put in the bar simply leaves it on Home.
	const leaf = pathname.split("/").pop() ?? "";
	const selected =
		TABS.find(({ to }) => to.endsWith(`/${leaf}`))?.to ?? "/systems/$serial";

	return (
		<nav className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex justify-center">
			{/* Each destination is its own route, so this is a controlled tab list
			    that navigates — the panels are the routes themselves. */}
			<Tabs
				selectedKey={selected}
				onSelectionChange={(key) =>
					navigate({ to: String(key), params: { serial } })
				}
			>
				{/* The pill is `bg-default`, a few points of lightness off the page,
				    so it needs an edge of its own — but a different one per theme.
				    Light takes the shadow: `--surface-shadow` is already defined as
				    no shadow in dark, so it needs no variant to stay out of the way.
				    Dark takes a rim instead, which is what reads on a near-black
				    background where a shadow cannot. It has to be `--segment`, the
				    indicator's own fill: plain `--border` sits within a point of the
				    pill and vanishes, and the secondary and tertiary borders — the
				    two that are defined as a `color-mix` rather than a literal
				    colour — do not render at all on iOS. */}
				{/* The radius is stated only below `sm`, where the bar is taller than
				    the stylesheet expects. `--radius * 2.5` is a fixed length tuned for
				    a one-line bar, and against a stacked one it stops reaching the
				    corners — it reads as a rounded box rather than a pill, and no
				    longer agrees with the tab pill sitting inside it. `rounded-full`
				    tracks whatever height the bar ends up at, which also keeps the
				    outer and inner radii consistent as the container's own padding
				    requires. Above `sm` the stylesheet's value is already right and is
				    left alone. */}
				<Tabs.ListContainer className="shadow-surface max-sm:rounded-full dark:border dark:border-segment">
					<Tabs.List aria-label="Sections">
						{TABS.map(({ to, label, Icon }) => (
							// Stacked under the icon on a phone, beside it from `sm` up —
							// see the note above the tab list. The height has to give way
							// with it: the base rule is a fixed `h-8` built for one line, so
							// stacking inside it would crop the label rather than make room
							// for it. `app-layout` reserves the taller bar at the same
							// breakpoint, so the page above never sits under it.
							<Tabs.Tab
								className="h-auto flex-col gap-0.5 px-3 py-1.5 text-xs sm:h-8 sm:flex-row sm:gap-2 sm:px-4 sm:py-0 sm:text-sm"
								id={to}
								key={to}
							>
								{/* A step larger where it is the main thing carrying the tab:
							    stacked over a small label on a phone, the icon is what the
							    eye lands on, and at the inline size it read as an accent to
							    the word rather than the other way round. */}
								<Icon className="size-5 shrink-0 sm:size-4" />
								{label}
								<Tabs.Indicator />
							</Tabs.Tab>
						))}
					</Tabs.List>
				</Tabs.ListContainer>
			</Tabs>
		</nav>
	);
}
