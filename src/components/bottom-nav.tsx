import { Tabs } from "@heroui/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { SlidersHorizontal, Waves } from "lucide-react";

/**
 * Two destinations only. A third would overflow on a small phone once labels
 * are translated — "Configuración" is nearly twice "Settings" — and HeroUI
 * answers overflow with scroll chevrons, which is no way to hide a primary
 * destination. Settings lives behind the header gear instead.
 */
const TABS = [
	{ to: "/systems/$serial", label: "Pool", Icon: Waves },
	{
		to: "/systems/$serial/equipment",
		label: "Equipment",
		Icon: SlidersHorizontal,
	},
] as const;

export function BottomNav({ serial }: { serial: string }) {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// Match on the resolved path so the tab tracks the URL, not a local state.
	const selected = pathname.endsWith("/equipment")
		? "/systems/$serial/equipment"
		: "/systems/$serial";

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
				<Tabs.ListContainer className="shadow-surface dark:border dark:border-segment">
					<Tabs.List aria-label="Sections">
						{TABS.map(({ to, label, Icon }) => (
							<Tabs.Tab className="gap-2" id={to} key={to}>
								<Icon className="size-4" />
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
