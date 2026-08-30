import { Button, Card } from "@heroui/react";
import { Sparkles } from "lucide-react";
import type { OneTouchMacro } from "#/lib/iaqualink/types";

/**
 * The panel's own scenes. What each one does was decided at the panel and is
 * not readable from here — only its name and whether it is the one running.
 * So this offers no icons or descriptions it would have to invent, just the
 * names the owner gave them.
 */
export function OneTouchHero({
	macros,
	onRun,
}: {
	macros: OneTouchMacro[];
	onRun: (macro: OneTouchMacro) => void;
}) {
	if (macros.length === 0) return null;

	return (
		<Card className="p-6">
			<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
				<Sparkles className="size-4 text-accent" />
				OneTouch
			</div>

			{/* Two per row, as the light and speed grids are — the labels are
			    owner-written and vary in length, so equal widths keep the block
			    from going ragged. */}
			<div className="grid grid-cols-2 gap-2">
				{macros.map((macro) => (
					<Button
						aria-pressed={macro.on}
						className="w-full justify-start text-xs"
						key={macro.name}
						onPress={() => onRun(macro)}
						size="sm"
						variant={macro.on ? "primary" : "tertiary"}
					>
						{macro.label}
					</Button>
				))}
			</div>
		</Card>
	);
}
