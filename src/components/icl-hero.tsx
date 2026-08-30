import {
	Button,
	Card,
	ColorArea,
	ColorPicker,
	ColorSlider,
	ColorSwatch,
	Label,
	parseColor,
	Slider,
} from "@heroui/react";
import { Lightbulb, LightbulbOff } from "lucide-react";
import { useEffect, useRef } from "react";
import {
	effectStops,
	ICL_CUSTOM_COLOR_ID,
	ICL_DIM_STEP,
	ICL_EFFECTS,
} from "#/lib/aqualink/enums";
import type { IclZone } from "#/lib/iaqualink/types";
import type { IclChange } from "#/lib/queries";
import { TrackSwitch } from "./track-switch";

/**
 * One iAquaLink Color Lights zone. Same shape as the WaterColors hero, with
 * brightness added — ICL dims where WaterColors cannot, and the panel reports
 * the running effect, so unlike WaterColors nothing has to be remembered
 * locally to know which swatch is live.
 */
export function IclHero({
	zone,
	onChange,
}: {
	zone: IclZone;
	onChange: (change: IclChange) => void;
}) {
	// Off is a state, not something to pick — the switch already covers it.
	const effects = Object.entries(ICL_EFFECTS).filter(([, id]) => id > 0);

	const [r, g, b, w] = zone.rgbw;
	const custom = parseColor(`rgb(${r}, ${g}, ${b})`);
	const isCustom = zone.colorId === ICL_CUSTOM_COLOR_ID;

	// Dragging reports continuously, and every report would be a command the
	// panel works through in turn — so only what the drag settles on is sent.
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	return (
		<Card className="p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						<Lightbulb className="size-4 text-accent" />
						{zone.label}
					</div>
				</div>

				<TrackSwitch
					device={{ ...ZONE_AS_DEVICE, label: zone.label, on: zone.on }}
					offIcon={LightbulbOff}
					offLabel="Off"
					onIcon={Lightbulb}
					onLabel="On"
					onToggle={(_d, on) =>
						onChange({ kind: "power", on, zoneId: zone.zoneId })
					}
				/>
			</div>

			{/* Brightness leads: it applies whatever colour is running, where a
			    swatch replaces it. Sending it while off would turn nothing on. */}
			{zone.on ? (
				<Slider
					maxValue={100}
					minValue={ICL_DIM_STEP}
					// Only on release: dragging fires continuously, and each of
					// those would be a command the panel has to work through.
					onChangeEnd={(v) =>
						onChange({
							dim: Number(v),
							kind: "brightness",
							zoneId: zone.zoneId,
						})
					}
					step={ICL_DIM_STEP}
					value={zone.dim}
				>
					{/* Label and reading share a line: the value belongs beside what
					    it is a value of, not stacked under it. */}
					<div className="flex items-baseline justify-between gap-2">
						<Label className="text-xs font-medium uppercase tracking-widest text-muted">
							Brightness
						</Label>
						<Slider.Output className="text-xs text-muted tabular-nums" />
					</div>
					<Slider.Track>
						<Slider.Fill />
						<Slider.Thumb />
					</Slider.Track>
				</Slider>
			) : null}

			<div className="grid grid-cols-2 gap-2">
				{effects.map(([name, id]) => {
					const stops = effectStops(name);
					return (
						<Button
							aria-pressed={zone.colorId === id}
							className="w-full justify-start text-xs"
							key={name}
							// Brightness rides along, since the panel takes both on one
							// command and omitting it would reset the zone to full.
							onPress={() =>
								onChange({
									colorId: id,
									dim: zone.dim,
									kind: "color",
									zoneId: zone.zoneId,
								})
							}
							size="sm"
							variant={zone.colorId === id && zone.on ? "primary" : "tertiary"}
						>
							<ColorSwatch
								className="shrink-0"
								color={stops[0] ?? "#888888"}
								colorName={name}
								size="xs"
								style={{
									background: `linear-gradient(${
										stops.length > 2 ? "90deg" : "180deg"
									}, ${stops.join(", ")})`,
								}}
							/>
							{name}
						</Button>
					);
				})}

				{/* The panel keeps one custom colour per zone and reports it back as
				    effect 16, so this belongs with the effects rather than apart from
				    them. White is a fourth LED channel with no picker of its own —
				    whatever the zone already had is passed through untouched. */}
				<ColorPicker
					// Inline-flex by default, so it shrinks to its trigger unless told
					// otherwise. Carries the metrics of a sm Button so it sits flush
					// with the effects rather than merely near them.
					className="w-full"
					onChange={(color) => {
						if (timer.current) clearTimeout(timer.current);
						timer.current = setTimeout(() => {
							const rgb = color.toFormat("rgb");
							onChange({
								kind: "custom",
								rgbw: [
									rgb.getChannelValue("red"),
									rgb.getChannelValue("green"),
									rgb.getChannelValue("blue"),
									w,
								],
								zoneId: zone.zoneId,
							});
						}, CUSTOM_DEBOUNCE_MS);
					}}
					value={custom}
				>
					<ColorPicker.Trigger
						className={`h-9 w-full gap-2 rounded-3xl px-3 text-xs md:h-8 ${
							isCustom && zone.on
								? "bg-accent text-accent-foreground"
								: "bg-default"
						}`}
					>
						<ColorSwatch className="shrink-0" size="xs" />
						<Label className="text-xs">Custom Color</Label>
					</ColorPicker.Trigger>
					<ColorPicker.Popover>
						<ColorArea
							aria-label="Custom colour"
							className="max-w-full"
							colorSpace="hsb"
							xChannel="saturation"
							yChannel="brightness"
						>
							<ColorArea.Thumb />
						</ColorArea>
						<ColorSlider
							aria-label="Hue"
							channel="hue"
							className="gap-1 px-1"
							colorSpace="hsb"
						>
							<ColorSlider.Track>
								<ColorSlider.Thumb />
							</ColorSlider.Track>
						</ColorSlider>
					</ColorPicker.Popover>
				</ColorPicker>
			</div>
		</Card>
	);
}

/** Long enough to cover a drag, short enough not to feel like a delay. */
const CUSTOM_DEBOUNCE_MS = 600;

/**
 * TrackSwitch speaks PoolDevice, and a zone is not one — it has no aux name
 * and never reaches a set_aux command. Only `label` and `on` are read, so the
 * rest is filler rather than a claim that a zone is a device.
 */
const ZONE_AS_DEVICE = {
	address: null,
	dimLevel: null,
	id: "icl",
	kind: "light" as const,
	label: "",
	name: "icl",
	on: false,
	raw: {},
	unit: null,
	value: null,
};
