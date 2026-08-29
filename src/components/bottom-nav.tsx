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
				<Tabs.ListContainer>
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
