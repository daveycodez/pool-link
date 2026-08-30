import { Button, Card, Chip, ColorSwatch, Spinner } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Blinds,
	Bubbles,
	Flame,
	Lightbulb,
	LightbulbOff,
	Sun,
	Waves,
} from "lucide-react";
import { useState } from "react";
import { AuxHero } from "#/components/aux-hero";
import { CardColumns } from "#/components/card-columns";
import { IclHero } from "#/components/icl-hero";
import { Loading } from "#/components/loading";
import { OneTouchHero } from "#/components/one-touch-hero";
import { TempStepper, tempRange } from "#/components/temp-stepper";
import { TrackSwitch } from "#/components/track-switch";
import { JANDY_WATERCOLORS, WATERCOLOR_STOPS } from "#/lib/aqualink/enums";
import { timeAgo } from "#/lib/format";
import { useHeatEta } from "#/lib/heat-eta";
import type {
	HeatPump,
	IclZone,
	OneTouchMacro,
	PoolDevice,
} from "#/lib/iaqualink/types";

/** The three readings a panel with chemistry automation reports. */
interface Chem {
	salinity: PoolDevice | undefined;
	orp: PoolDevice | undefined;
	ph: PoolDevice | undefined;
}

import type { IclChange, RememberedTemp } from "#/lib/queries";
import {
	lastLightEffect,
	rememberLightEffect,
	TEMP_STALE_MS,
	useActuate,
	useIclZone,
	useLightColor,
	useLightHolds,
	useOneTouch,
	useSetPoint,
} from "#/lib/queries";
import {
	isJandyLight,
	isReported,
	usePool,
	useRequireSession,
} from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/")({
	component: Pool,
});

function Pool() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const {
		loading,
		snap,
		spaMode,
		water,
		waterMemory,
		poolSet,
		spaSet,
		heaters,
		heatPump,
		spaPump,
		iclZones,
		macros,
		cover,
		solar,
		freezing,
		hpmFault,
		chem,
		auxes,
		celsius,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setPoint = useSetPoint(serial);
	const lightColor = useLightColor(serial);
	const iclZone = useIclZone(serial);
	const oneTouch = useOneTouch(serial);
	const held = useLightHolds(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	/**
	 * The hero's Spa switch is one touch. Throwing the valves without the heat
	 * leaves someone standing in cold water, so switching spa mode on brings
	 * the spa heater with it when the heater is off — one after the other,
	 * because the pad works a single RS-485 command at a time.
	 *
	 * Only on, and only here. Switching off leaves the heater alone, and the
	 * equipment page's switches stay what they say they are — the granular
	 * control is a tap away for anyone who wants the valves without the heat.
	 */
	const toggle = (device: PoolDevice, on: boolean) => {
		const spaHeater = heaters.find((h) => h.name.startsWith("spa"));
		const also =
			on && device.name === "spa_pump" && spaHeater && !spaHeater.on
				? spaHeater
				: undefined;
		actuate.mutate({ also, device, on });
	};

	return (
		<PoolScreen
			held={held}
			serial={serial}
			water={water}
			waterMemory={waterMemory}
			spaMode={spaMode}
			heaters={heaters}
			heatPump={heatPump}
			updatedAt={snap.dataUpdatedAt}
			spaPump={spaPump}
			cover={cover}
			solar={solar}
			iclZones={iclZones}
			macros={macros}
			onRunMacro={(m) => oneTouch.mutate(m.name)}
			freezing={freezing}
			hpmFault={hpmFault}
			onIclChange={(change) => iclZone.mutate(change)}
			chem={chem}
			auxes={auxes}
			celsius={celsius}
			poolSet={poolSet}
			spaSet={spaSet}
			onToggle={toggle}
			onSetPoint={(name, value) => setPoint.mutate({ name, value })}
			onLightColor={(device, effectId) =>
				lightColor.mutate({
					name: device.name,
					subtype:
						typeof device.raw.subtype === "string" ? device.raw.subtype : "",
					effectId,
				})
			}
		/>
	);
}

function PoolScreen({
	held,
	water,
	waterMemory,
	spaMode,
	heaters,
	heatPump,
	updatedAt,
	serial,
	spaPump,
	cover,
	solar,
	freezing,
	hpmFault,
	chem,
	iclZones,
	macros,
	auxes,
	onIclChange,
	onRunMacro,
	celsius,
	poolSet,
	spaSet,
	onToggle,
	onSetPoint,
	onLightColor,
}: {
	/** Lights mid-change, so their heroes can show progress. */
	held: { devices: Set<string>; zones: Set<number> };
	water: PoolDevice | undefined;
	/** Stands in for the reading when the panel reports none. */
	waterMemory: RememberedTemp | null;
	spaMode: boolean;
	heaters: PoolDevice[];
	heatPump: HeatPump | null;
	/** When the panel last answered, which is the estimator's only clock. */
	updatedAt: number;
	spaPump: PoolDevice | undefined;
	cover: PoolDevice | undefined;
	solar: PoolDevice | undefined;
	freezing: boolean;
	hpmFault: string;
	chem: Chem;
	auxes: PoolDevice[];
	iclZones: IclZone[];
	macros: OneTouchMacro[];
	onIclChange: (change: IclChange) => void;
	onRunMacro: (macro: OneTouchMacro) => void;
	celsius: boolean;
	poolSet: PoolDevice | undefined;
	spaSet: PoolDevice | undefined;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetPoint: (name: string, value: number) => void;
	onLightColor: (device: PoolDevice, effectId: number) => void;
	serial: string;
}) {
	return (
		<CardColumns>
			<PoolSpaHero
				celsius={celsius}
				heater={heaters.find((h) =>
					spaMode ? h.name.startsWith("spa") : h.name.startsWith("pool"),
				)}
				heatPump={heatPump}
				serial={serial}
				updatedAt={updatedAt}
				onSetPoint={(t) =>
					onSetPoint(spaMode ? "spa_set_point" : "pool_set_point", t)
				}
				onToggle={onToggle}
				setPoint={spaMode ? spaSet : poolSet}
				spaMode={spaMode}
				spaPump={spaPump}
				cover={cover}
				solar={solar}
				freezing={freezing}
				hpmFault={hpmFault}
				chem={chem}
				water={water}
				waterMemory={waterMemory}
			/>

			{/* Zones are not relays, so they sit outside the loop below — the
			    panel lists them separately and so does this. */}
			{iclZones.map((zone) => (
				<IclHero
					key={zone.zoneId}
					onChange={onIclChange}
					pending={held.zones.has(zone.zoneId)}
					zone={zone}
				/>
			))}

			{/* One card per relay, in the panel's own order. A relay that reports
			    as a Jandy colour light gets the effects hero; everything else is
			    a switch, so what appears follows the panel rather than this app. */}
			{auxes.map((aux) =>
				isJandyLight(aux) ? (
					<WaterColorsHero
						device={aux}
						key={aux.id}
						onColor={(effectId) => onLightColor(aux, effectId)}
						onToggle={(on) => onToggle(aux, on)}
						pending={held.devices.has(aux.name)}
						serial={serial}
					/>
				) : (
					<AuxHero
						device={aux}
						key={aux.id}
						onToggle={(on) => onToggle(aux, on)}
						serial={serial}
					/>
				),
			)}

			{/* Last: nearly everything a scene does is available above it, and
			    more directly. It is here for the combinations that are not. */}
			<OneTouchHero macros={macros} onRun={onRunMacro} />
		</CardColumns>
	);
}

/**
 * One card for both bodies, with the spa pump as the swap.
 * The panel only reports a temperature for whichever body is circulating, so
 * flipping this changes which reading exists at all — not just which is shown.
 */
function PoolSpaHero({
	water,
	waterMemory,
	spaMode,
	celsius,
	serial,
	spaPump,
	cover,
	solar,
	freezing,
	hpmFault,
	chem,
	heater,
	heatPump,
	updatedAt,
	setPoint,
	onToggle,
	onSetPoint,
}: {
	water: PoolDevice | undefined;
	waterMemory: RememberedTemp | null;
	spaMode: boolean;
	celsius: boolean;
	serial: string;
	spaPump: PoolDevice | undefined;
	cover: PoolDevice | undefined;
	solar: PoolDevice | undefined;
	freezing: boolean;
	hpmFault: string;
	chem: Chem;
	heater: PoolDevice | undefined;
	heatPump: HeatPump | null;
	updatedAt: number;
	setPoint: PoolDevice | undefined;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetPoint: (temp: number) => void;
}) {
	const target = Number(setPoint?.value);
	// The committed panel value, not the stepper's draft: a target still inside
	// its 600ms debounce is a number nobody has asked the panel for yet.
	const eta = useHeatEta({
		celsius,
		freezing,
		heatPump,
		heater,
		serial,
		target,
		updatedAt,
		water,
	});
	/**
	 * The estimate when the panel is answering, the reading's age when it is
	 * not. An estimate over a remembered number would be arithmetic on a
	 * temperature nobody is measuring any more, so the two never overlap.
	 */
	const caption = water?.value
		? eta
		: waterMemory && updatedAt - waterMemory.at >= TEMP_STALE_MS
			? timeAgo(waterMemory.at, updatedAt)
			: "";
	// One width for the stack: these switches sit above one another, right
	// aligned, so any difference between them reads as a mistake.
	const trackWidth = "w-17";
	return (
		<Card className="p-6">
			{/* Two columns, not one row: the switch stack grows downward on its own
			    without pushing the reading down or resizing the card. */}
			<div className="flex items-start justify-between gap-4">
				<div>
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						{/* Spa carries the same warning tone as the switch that selects
						    it, so the card's state reads at a glance. */}
						{spaMode ? (
							<Bubbles className="size-4 text-warning" />
						) : (
							<Waves className="size-4 text-accent" />
						)}
						{spaMode ? "Spa" : "Pool"}
						{/* The panel overrides equipment while this is on, so it is
						    said here rather than left to look like a fault. */}
						{freezing ? (
							<Chip color="warning" variant="soft">
								Freeze
							</Chip>
						) : null}
						{/* A fault means the pump has stopped doing what was asked, so
						    it says what rather than only that something is wrong. */}
						{hpmFault ? (
							<Chip color="danger" variant="soft">
								{hpmFault}
							</Chip>
						) : null}
					</div>

					<div className="mt-2 flex items-baseline gap-1.5 leading-none">
						<span className="text-7xl font-semibold tabular-nums tracking-tighter">
							{water?.value || waterMemory?.value || "—"}
						</span>
						{/* The degree sits at the reading's baseline, which leaves the
						    whole height of a 7xl numeral empty beneath it — so the
						    estimate goes there rather than on a line of its own. It
						    comes and goes without moving anything below it. */}
						<div className="flex flex-col items-start gap-1.5">
							<span className="text-2xl text-muted">{water?.unit ?? "°"}</span>
							{/* One slot, two things that are never both true: an estimate
							    belongs to a live reading, and an age belongs to one the
							    panel has stopped giving. A remembered number says nothing
							    for its first half hour, because the water has barely moved
							    and it is as good as live — after that it has to admit what
							    it is. */}
							{caption ? (
								<Chip className="whitespace-nowrap" variant="soft">
									{caption}
								</Chip>
							) : null}
						</div>
					</div>

					{/* Target sits under the reading so the two can be compared — the
					    whole point of showing both. */}
					{Number.isFinite(target) ? (
						<TempStepper
							className="mt-3 w-fit"
							onCommit={onSetPoint}
							range={tempRange(celsius)}
							value={target}
						/>
					) : null}
				</div>

				<div className="flex flex-col items-end gap-3">
					{isReported(spaPump) ? (
						<TrackSwitch
							device={spaPump}
							// Icon and label both name what the switch controls, like
							// the heater and cover beside it — the position says on or
							// off, so swapping either read as a mode picker instead.
							offIcon={Bubbles}
							offLabel="Spa"
							onIcon={Bubbles}
							onLabel="Spa"
							trackWidth={trackWidth}
							onToggle={onToggle}
							tone="warning"
						/>
					) : null}
					{isReported(heater) ? (
						<TrackSwitch
							device={heater}
							offIcon={Flame}
							offLabel="Heat"
							onIcon={Flame}
							onLabel="Heat"
							trackWidth={trackWidth}
							onToggle={onToggle}
							tone="danger"
						/>
					) : null}
					{/* Solar sits with the heater it supplements, and serves whichever
					    body is circulating — so it does not swap with the mode. */}
					{isReported(solar) ? (
						<TrackSwitch
							device={solar}
							offIcon={Sun}
							offLabel="Heat"
							onIcon={Sun}
							onLabel="Heat"
							trackWidth={trackWidth}
							onToggle={onToggle}
							tone="danger"
						/>
					) : null}
					{/* Shown whenever the panel reports a cover, in either mode. Which
					    water it covers is not ours to assume — combo covers span both
					    bodies and spa-only installs exist — and even a pool-only cover
					    is worth closing while someone sits in the spa. */}
					{isReported(cover) ? (
						<TrackSwitch
							device={cover}
							offIcon={Blinds}
							offLabel="Cover"
							onIcon={Blinds}
							onLabel="Cover"
							trackWidth={trackWidth}
							onToggle={onToggle}
						/>
					) : null}
				</div>
			</div>

			<ChemRow chem={chem} />
		</Card>
	);
}

/**
 * Where each reading should sit. The panel publishes no targets of its own, so
 * these are the standard pool-industry bands — right for most pools, and worth
 * revisiting if a chlorinator disagrees about salt.
 */
const CHEM_BANDS = {
	ph: { ok: [7.2, 7.8], near: [7.0, 8.0] },
	orp: { ok: [650, 850], near: [600, 900] },
	salt: { ok: [2700, 3400], near: [2400, 4000] },
} as const;

interface Band {
	readonly ok: readonly [number, number];
	readonly near: readonly [number, number];
}

/**
 * In range takes the accent, drifting amber, out of range red. Green is
 * deliberately unused: it is the one colour a pool owner does not want to see,
 * and red/green is the pair most often indistinguishable.
 */
function chemTone(value: string, band: Band): "accent" | "warning" | "danger" {
	const n = Number(value);
	if (!Number.isFinite(n)) return "accent";
	if (n >= band.ok[0] && n <= band.ok[1]) return "accent";
	if (n >= band.near[0] && n <= band.near[1]) return "warning";
	return "danger";
}

/**
 * The readings a panel with chemistry automation reports. Absent probes report
 * nothing, so the row hides itself rather than leaving a gap under the
 * temperature — and salinity follows the body on show, since each has its own.
 */
function ChemRow({ chem }: { chem: Chem }) {
	const readings = [
		{ band: CHEM_BANDS.ph, device: chem.ph, label: "pH", unit: "" },
		{ band: CHEM_BANDS.orp, device: chem.orp, label: "ORP", unit: "mV" },
		{
			band: CHEM_BANDS.salt,
			device: chem.salinity,
			label: "Salt",
			unit: "ppm",
		},
	]
		.map((r) => ({ ...r, value: r.device?.value?.trim() ?? "" }))
		.filter((r) => r.value !== "");

	if (readings.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-1.5">
			{readings.map(({ band, label, unit, value }) => (
				<Chip color={chemTone(value, band)} key={label} variant="soft">
					<span className="opacity-70">{label}</span>
					<span className="tabular-nums">
						{value}
						{unit ? ` ${unit}` : ""}
					</span>
				</Chip>
			))}
		</div>
	);
}

/**
 * A Jandy LED WaterColors light. Its sibling is IclHero: same anatomy, but a
 * different effect table, and this family has no dimming.
 *
 * The panel reports a WaterColors light's on/off but never its colour, so the
 * swatch grid shows nothing selected until a choice is made in this session. Picking one
 * tints the card's ambient glow, which is the closest the UI can get to
 * showing what the water actually looks like.
 */
function WaterColorsHero({
	device,
	serial,
	pending,
	onToggle,
	onColor,
}: {
	device: PoolDevice;
	serial: string;
	/** A change is still working through the fixture's pulse sequence. */
	pending: boolean;
	onToggle: (on: boolean) => void;
	onColor: (effectId: number) => void;
}) {
	// The panel never reports this light's colour, so the app's memory of the
	// last pick — per system, per light — is the only knowledge there is. It
	// seeds the highlight, and the switch resumes it on the way back on.
	const last = lastLightEffect(serial, device.name);
	const lastName =
		Object.entries(JANDY_WATERCOLORS).find(([, id]) => id === last)?.[0] ??
		null;
	const [picked, setPicked] = useState<string | null>(lastName);
	// The marked swatch: the remembered pick — or, while off, Alpine White as
	// the default, the same way an off pump previews its first speed. Either
	// way the dimmed swatch says exactly what "on" will do.
	const marked = picked ?? (device.on ? null : "Alpine White");
	const effects = Object.keys(JANDY_WATERCOLORS).filter(
		(name) => JANDY_WATERCOLORS[name] > 0,
	);

	return (
		<Card className="p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						<Lightbulb className="size-4 text-accent" />
						{device.label}
					</div>
				</div>

				<div className="flex items-center gap-3">
					{/* The panel gives no progress for the pulse sequence, so this
					    runs for the hold window — the same trick as the official
					    app's progress bar. */}
					{pending ? (
						<Spinner color="current" className="text-muted" size="sm" />
					) : null}
					<TrackSwitch
						device={device}
						// A toggle would inject a relay pulse into the sequence the
						// panel is counting out, and the fixture counts it too.
						isDisabled={pending}
						offIcon={LightbulbOff}
						offLabel="Off"
						onIcon={Lightbulb}
						onLabel="On"
						trackWidth="w-16"
						onToggle={(_d, on) => {
							// On resumes the last colour we know — powering up resets
							// the fixture to Alpine White, and the memory beats the
							// reset. Unless the memory IS Alpine White: the bare relay
							// close lands there by itself, and programming it would
							// spin through a whole redundant reset cycle.
							if (
								on &&
								last !== undefined &&
								last !== JANDY_WATERCOLORS["Alpine White"]
							) {
								setPicked(lastName);
								onColor(last);
								return;
							}
							if (on) {
								setPicked("Alpine White");
								// The bare relay-on landed the fixture on white just as
								// surely as programming it would have — remember it.
								rememberLightEffect(
									serial,
									device.name,
									JANDY_WATERCOLORS["Alpine White"],
								);
							}
							onToggle(on);
						}}
					/>
				</div>
			</div>

			{/* Two per row, equal width — the names vary a lot in length, and a
			    wrapped row would leave every line ending somewhere different. */}
			<div className="grid grid-cols-2 gap-2">
				{effects.map((name) => {
					const stops = WATERCOLOR_STOPS[name] ?? [];
					return (
						<Button
							aria-pressed={picked === name}
							className="w-full justify-start text-xs"
							// One colour at a time: stacked effect changes make the pad
							// pulse through every one of them, and pulse-counting is how
							// WaterColors drift out of sync. The official app blocks the
							// same way, behind its progress bar.
							isDisabled={pending}
							key={name}
							// Effect ids start at 1 and 0 is "off", so setting one turns the
							// light on as well — no separate toggle, which would race the
							// colour with a plain on command.
							onPress={() => {
								setPicked(name);
								onColor(JANDY_WATERCOLORS[name]);
							}}
							size="sm"
							// Primary only while the change is in flight: for those
							// seconds we know what the fixture is being told, so the
							// swatch commits alongside the spinner. Once it lands
							// nothing confirms it — the panel never reports this
							// fixture's colour, and anyone at the pad can change it —
							// so it falls back to secondary: a hint at what the switch
							// will go to, not a claim about what is lit.
							variant={
								marked === name
									? pending
										? "primary"
										: "secondary"
									: "tertiary"
							}
						>
							<ColorSwatch
								className="shrink-0"
								color={stops[0]}
								// The effect name, not a colour name: these run through more than
								// one hue, and "Fat Tuesday" is what the panel calls it.
								colorName={name}
								size="xs"
								// Matching how the app draws them: the two-stop colours run top
								// to bottom, the shows sweep left to right. The stop count is
								// the tell, so the data decides rather than a list of names.
								style={{
									background: `linear-gradient(${
										stops.length > 2 ? "90deg" : "180deg"
									}, ${stops.join(", ")})`,
								}}
							/>
							<span className="truncate">{name}</span>
						</Button>
					);
				})}
			</div>
		</Card>
	);
}
