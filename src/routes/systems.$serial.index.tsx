import { Button, Card, NumberField, Switch } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Bubbles,
	Flame,
	Lightbulb,
	LightbulbOff,
	Waves,
	Wind,
} from "lucide-react";
import { useState } from "react";
import { EquipmentRow } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { JANDY_WATERCOLORS, WATERCOLOR_HEX } from "#/lib/aqualink/enums";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useLightColor, useSetTemps } from "#/lib/queries";
import { usePool, useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/")({
	component: Pool,
});

function Pool() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const {
		loading,
		spaMode,
		water,
		poolSet,
		spaSet,
		heaters,
		light,
		jetPump,
		spaPump,
		waterfall,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setTemps = useSetTemps(serial);
	const lightColor = useLightColor(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	return (
		<PoolScreen
			water={water}
			spaMode={spaMode}
			heaters={heaters}
			jetPump={jetPump}
			spaPump={spaPump}
			waterfall={waterfall}
			poolSet={poolSet}
			spaSet={spaSet}
			light={light}
			busy={actuate.isPending || setTemps.isPending || lightColor.isPending}
			onToggle={(d, on) => actuate.mutate({ device: d, on })}
			onSetTemps={(sp, pl) => setTemps.mutate({ spa: sp, pool: pl })}
			onLightColor={(effectId) =>
				light
					? lightColor.mutate({
							name: light.name,
							subtype:
								typeof light.raw.subtype === "string" ? light.raw.subtype : "",
							effectId,
						})
					: undefined
			}
		/>
	);
}

function PoolScreen({
	water,
	spaMode,
	heaters,
	jetPump,
	spaPump,
	waterfall,
	poolSet,
	spaSet,
	light,
	busy,
	onToggle,
	onSetTemps,
	onLightColor,
}: {
	water: PoolDevice | undefined;
	spaMode: boolean;
	heaters: PoolDevice[];
	jetPump: PoolDevice | undefined;
	spaPump: PoolDevice | undefined;
	waterfall: PoolDevice | undefined;
	poolSet: PoolDevice | undefined;
	spaSet: PoolDevice | undefined;
	light: PoolDevice | undefined;
	busy: boolean;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetTemps: (spa: string, pool: string) => void;
	onLightColor: (effectId: number) => void;
}) {
	return (
		<div className="space-y-4">
			<ModeHero
				busy={busy}
				heater={heaters.find((h) =>
					spaMode ? h.name.startsWith("spa") : h.name.startsWith("pool"),
				)}
				jetPump={jetPump}
				onSetPoint={(t) =>
					spaMode
						? onSetTemps(String(t), poolSet?.value ?? "")
						: onSetTemps(spaSet?.value ?? "", String(t))
				}
				onToggle={onToggle}
				setPoint={spaMode ? spaSet : poolSet}
				spaMode={spaMode}
				spaPump={spaPump}
				water={water}
			/>

			{light ? (
				<LightHero
					device={light}
					busy={busy}
					onToggle={(on) => onToggle(light, on)}
					onColor={onLightColor}
				/>
			) : null}

			{waterfall ? (
				<EquipmentRow
					device={waterfall}
					busy={busy}
					onToggle={(on) => onToggle(waterfall, on)}
				/>
			) : null}
		</div>
	);
}

/**
 * Experimental hero: one card for both bodies, with the spa pump as the swap.
 * The panel only reports a temperature for whichever body is circulating, so
 * flipping this changes which reading exists at all — not just which is shown.
 */
function ModeHero({
	water,
	spaMode,
	spaPump,
	jetPump,
	heater,
	setPoint,
	busy,
	onToggle,
	onSetPoint,
}: {
	water: PoolDevice | undefined;
	spaMode: boolean;
	spaPump: PoolDevice | undefined;
	jetPump: PoolDevice | undefined;
	heater: PoolDevice | undefined;
	setPoint: PoolDevice | undefined;
	busy: boolean;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetPoint: (temp: number) => void;
}) {
	// Ranges the panel accepts, and the granularity it steps in.
	const range = spaMode
		? { min: 98, max: 104, step: 1 }
		: { min: 78, max: 88, step: 2 };
	const target = Number(setPoint?.value);
	return (
		<Card className="relative overflow-hidden p-6">
			<div
				aria-hidden
				className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full"
				style={{
					background:
						"radial-gradient(circle, color-mix(in oklab, var(--accent) 12%, transparent) 0%, transparent 75%)",
				}}
			/>

			{/* Two columns, not one row: the switch stack grows downward on its own
			    without pushing the reading down or resizing the card. */}
			<div className="flex items-start justify-between gap-4">
				<div>
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						{spaMode ? (
							<Bubbles className="size-4 text-accent" />
						) : (
							<Waves className="size-4 text-accent" />
						)}
						{spaMode ? "Spa" : "Pool"}
					</div>

					<div className="mt-2 flex items-baseline gap-1.5 leading-none">
						<span className="text-7xl font-semibold tabular-nums tracking-tighter">
							{water?.value ?? "—"}
						</span>
						<span className="text-2xl text-muted">{water?.unit ?? "°"}</span>
					</div>

					{/* Target sits under the reading so the two can be compared — the
					    whole point of showing both. */}
					{Number.isFinite(target) ? (
						<NumberField
							aria-label="Target temperature"
							className="mt-3 w-fit"
							isDisabled={busy || !heater?.on}
							maxValue={range.max}
							minValue={range.min}
							onChange={onSetPoint}
							step={range.step}
							value={target}
							variant="secondary"
						>
							<NumberField.Group>
								<NumberField.DecrementButton />
								<NumberField.Input className="w-14 text-center" />
								<NumberField.IncrementButton />
							</NumberField.Group>
						</NumberField>
					) : null}
				</div>

				<div className="flex flex-col items-end gap-3">
					{spaPump ? (
						<TrackSwitch
							device={spaPump}
							busy={busy}
							offIcon={Waves}
							offLabel="Pool"
							onIcon={Bubbles}
							onLabel="Spa"
							onToggle={onToggle}
							tone="warning"
						/>
					) : null}
					{/* Jets only exist as a spa control — no reason to offer them while
					    the valves are set to pool. */}
					{heater ? (
						<TrackSwitch
							device={heater}
							busy={busy}
							offIcon={Flame}
							offLabel="Heat"
							onIcon={Flame}
							onLabel="Heat"
							onToggle={onToggle}
							tone="danger"
						/>
					) : null}
					{spaMode && jetPump ? (
						<TrackSwitch
							device={jetPump}
							busy={busy}
							offIcon={Wind}
							offLabel="Jets"
							onIcon={Wind}
							onLabel="Jets"
							onToggle={onToggle}
						/>
					) : null}
				</div>
			</div>
		</Card>
	);
}

/** A switch whose label sits in the track, uncovered by the thumb. */
function TrackSwitch({
	device,
	onLabel,
	offLabel,
	onIcon: OnIcon,
	offIcon: OffIcon,
	tone = "accent",
	busy,
	onToggle,
}: {
	device: PoolDevice;
	onLabel: string;
	offLabel: string;
	onIcon: React.ComponentType<{ className?: string }>;
	offIcon: React.ComponentType<{ className?: string }>;
	/** Selected-state colour, so spa and heat read apart from the rest. */
	tone?: "accent" | "warning" | "danger";
	busy: boolean;
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
			isDisabled={busy}
			isSelected={device.on}
			onChange={(on: boolean) => onToggle(device, on)}
			size="lg"
		>
			{({ isSelected }) => (
				<Switch.Content>
					{/* The control is `relative overflow-hidden`, so the label can sit in
				    the track and be uncovered by the thumb. */}
					<Switch.Control className={`w-17 ${isSelected ? toned.bg : ""}`}>
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

/**
 * Effects that cycle rather than hold one colour. Each swatch blends the two
 * hues the show is built around, so it reads as motion without pretending to
 * be a flat colour. Inferred from the effect names — USA! and Fat Tuesday have
 * fixed schemes; the splashes and Disco Tech are a judgement call.
 */
const LIGHT_SHOWS: Record<string, [string, string]> = {
	"Slow Splash": ["#2a7fff", "#00d4ff"],
	"Fast Splash": ["#ff5a2a", "#ffd12a"],
	"USA!": ["#e4032a", "#1f3fbf"],
	"Fat Tuesday": ["#6a0dad", "#f5c518"],
	"Disco Tech": ["#ff3ed0", "#00d4ff"],
};

/**
 * The panel reports a light's on/off but never its colour, so the swatch grid
 * shows nothing selected until a choice is made in this session. Picking one
 * tints the card's ambient glow, which is the closest the UI can get to
 * showing what the water actually looks like.
 */
function LightHero({
	device,
	busy,
	onToggle,
	onColor,
}: {
	device: PoolDevice;
	busy: boolean;
	onToggle: (on: boolean) => void;
	onColor: (effectId: number) => void;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const effects = Object.keys(JANDY_WATERCOLORS).filter(
		(name) => JANDY_WATERCOLORS[name] > 0,
	);
	const glow = picked ? WATERCOLOR_HEX[picked] : "var(--accent)";

	return (
		<Card className="relative overflow-hidden p-6">
			<div
				aria-hidden
				className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full transition-colors duration-500"
				style={{
					background: `radial-gradient(circle, color-mix(in oklab, ${glow} ${
						device.on ? "22%" : "8%"
					}, transparent) 0%, transparent 75%)`,
				}}
			/>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						<Lightbulb className="size-4 text-accent" />
						{device.label}
					</div>
					{picked ? (
						<div className="mt-1 truncate text-lg font-semibold tracking-tight">
							{picked}
						</div>
					) : null}
				</div>

				<TrackSwitch
					device={device}
					busy={busy}
					offIcon={LightbulbOff}
					offLabel="Off"
					onIcon={Lightbulb}
					onLabel="On"
					onToggle={(_d, on) => onToggle(on)}
				/>
			</div>

			{/* Two per row, equal width — the names vary a lot in length, and a
			    wrapped row would leave every line ending somewhere different. */}
			<div className="grid grid-cols-2 gap-2">
				{effects.map((name) => (
					<Button
						aria-pressed={picked === name}
						className={`w-full justify-start text-xs ${
							picked === name ? "ring-2 ring-accent ring-inset" : ""
						}`}
						isDisabled={busy}
						key={name}
						onPress={() => {
							setPicked(name);
							onColor(JANDY_WATERCOLORS[name]);
						}}
						size="sm"
						variant="tertiary"
					>
						<span
							className="size-4 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15"
							style={{
								background: LIGHT_SHOWS[name]
									? `linear-gradient(135deg, ${LIGHT_SHOWS[name][0]}, ${LIGHT_SHOWS[name][1]})`
									: WATERCOLOR_HEX[name],
							}}
						/>
						{name}
					</Button>
				))}
			</div>
		</Card>
	);
}
