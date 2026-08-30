import { Switch } from "@heroui/react";
import type { PoolDevice } from "#/lib/iaqualink/types";

/** A switch whose label sits in the track, uncovered by the thumb. */
export function TrackSwitch({
	device,
	onLabel,
	offLabel,
	onIcon: OnIcon,
	offIcon: OffIcon,
	tone = "accent",
	isDisabled,
	trackWidth = "w-17",
	onToggle,
}: {
	device: PoolDevice;
	onLabel: string;
	offLabel: string;
	onIcon: React.ComponentType<{ className?: string }>;
	offIcon: React.ComponentType<{ className?: string }>;
	/** Selected-state colour, so spa and heat read apart from the rest. */
	tone?: "accent" | "warning" | "danger";
	/** Held while a change is working through the device it switches. */
	isDisabled?: boolean;
	/**
	 * Track width, so one card can size its switch without moving every other
	 * switch in the app. The label centres in whatever the thumb leaves
	 * uncovered, so any width works without touching the insets below.
	 */
	trackWidth?: string;
	onToggle: (d: PoolDevice, on: boolean) => void;
}) {
	const toned = {
		accent: { bg: "", icon: "text-inherit" },
		warning: { bg: "bg-warning", icon: "text-warning" },
		danger: { bg: "bg-danger", icon: "text-danger" },
	}[tone];
	return (
		// `.switch` is a flex column holding the track plus a hidden input, so it
		// is taller than the track and the track floats inside it. Pinning it to
		// the track's own height makes it exactly as tall as the eyebrow label
		// beside it, so the two line up rather than merely starting level.
		<Switch
			className="h-6 justify-center"
			aria-label={onLabel}
			isDisabled={isDisabled}
			isSelected={device.on}
			onChange={(on: boolean) => onToggle(device, on)}
			size="lg"
		>
			{({ isSelected }) => (
				<Switch.Content>
					{/* The control is `relative overflow-hidden`, so the label can sit in
				    the track and be uncovered by the thumb. */}
					<Switch.Control
						className={`${trackWidth} ${isSelected ? toned.bg : ""}`}
					>
						<span
							// Inset by the thumb's exact footprint — 1.71875rem wide plus
							// its 0.125rem margin, per switch.css — so the label box is
							// precisely the track the thumb leaves uncovered. Centring in
							// that is exact at any track width.
							className={`pointer-events-none absolute inset-y-0 flex items-center justify-center text-[10px] font-semibold uppercase ${
								isSelected
									? "right-[1.6875rem] left-0 text-accent-foreground"
									: "right-0 left-[1.6875rem] text-muted"
							}`}
						>
							{isSelected ? onLabel : offLabel}
						</span>
						<Switch.Thumb>
							<Switch.Icon>
								{isSelected ? (
									<OnIcon className={`size-3 ${toned.icon}`} />
								) : (
									<OffIcon className="size-3 text-inherit" />
								)}
							</Switch.Icon>
						</Switch.Thumb>
					</Switch.Control>
				</Switch.Content>
			)}
		</Switch>
	);
}
