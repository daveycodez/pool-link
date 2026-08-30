import { Button, Card } from "@heroui/react";
import { Wand2 } from "lucide-react";
import { useState } from "react";
import type { OneTouchMacro } from "#/lib/iaqualink/types";
import { macroIcon } from "./preset-icons";

/**
 * The panel's own scenes. What each one does is decided at the panel and is
 * not readable from here — the name is the only thing to go on, so the icon
 * comes from that and nothing else is offered that would have to be invented.
 */
export function OneTouchHero({
	macros,
	onRun,
}: {
	macros: OneTouchMacro[];
	onRun: (macro: OneTouchMacro) => void;
}) {
	// A scene takes a while to land, and until it does the panel still reports
	// the old one. Holding the press locally means the button fills on the tap
	// rather than a poll later — the panel's answer wins as soon as it has one.
	const [picked, setPicked] = useState<string | null>(null);
	const active = macros.find((m) => m.on)?.name ?? picked;

	if (macros.length === 0) return null;

	// The panel's order otherwise, because it is the owner's: these are laid
	// out at the pad and their sequence there is a choice someone made. All Off
	// is the exception — it undoes the rest rather than being one of them, so
	// it belongs after them however the panel happens to list it.
	const ordered = [...macros].sort(
		(a, b) => Number(isAllOff(a)) - Number(isAllOff(b)),
	);

	return (
		<Card className="p-6">
			<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
				<Wand2 className="size-4 text-accent" />
				OneTouch
			</div>

			{/* Two per row, as the light and speed grids are — the labels are
			    owner-written and vary in length, so equal widths keep the block
			    from going ragged. */}
			<div className="grid grid-cols-2 gap-2">
				{ordered.map((macro) => {
					const Icon = macroIcon(macro.label);
					return (
						<Button
							aria-pressed={active === macro.name}
							className="w-full justify-start text-xs"
							key={macro.name}
							onPress={() => {
								setPicked(macro.name);
								onRun(macro);
							}}
							size="sm"
							variant={active === macro.name ? "primary" : "tertiary"}
						>
							<Icon
								// Muted while idle so the name leads; against the filled
								// accent it takes the foreground meant to sit on it.
								className={`shrink-0 ${
									active === macro.name
										? "text-accent-foreground"
										: "text-muted"
								}`}
							/>
							<span className="truncate">{macro.label}</span>
						</Button>
					);
				})}
			</div>
		</Card>
	);
}

/**
 * Matched on the label rather than a name, because the panel names macros
 * `onetouch_1` through `onetouch_N` in the order their buttons sit on the pad
 * and says nothing about what any of them does. "All Off" is what the owner
 * called it, and the spelling is theirs — so this is loose about spacing and
 * case and asks for nothing else.
 */
function isAllOff(macro: OneTouchMacro): boolean {
	return macro.label.replace(/\s+/g, "").toLowerCase() === "alloff";
}
