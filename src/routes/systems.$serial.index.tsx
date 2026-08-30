import { Button, Card, Chip, ColorSwatch } from "@heroui/react";
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
import { IclHero } from "#/components/icl-hero";
import { Loading } from "#/components/loading";
import { OneTouchHero } from "#/components/one-touch-hero";
import { TempStepper, tempRange } from "#/components/temp-stepper";
import { TrackSwitch } from "#/components/track-switch";
import { JANDY_WATERCOLORS, WATERCOLOR_STOPS } from "#/lib/aqualink/enums";
import type { IclZone, OneTouchMacro, PoolDevice } from "#/lib/iaqualink/types";

/** The three readings a panel with chemistry automation reports. */
interface Chem {
	salinity: PoolDevice | undefined;
	orp: PoolDevice | undefined;
	ph: PoolDevice | undefined;
}

import type { IclChange } from "#/lib/queries";
import {
	useActuate,
	useIclZone,
	useLightColor,
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
		spaMode,
		water,
		poolSet,
		spaSet,
		heaters,
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

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	return (
		<PoolScreen
			serial={serial}
			water={water}
			spaMode={spaMode}
			heaters={heaters}
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
			onToggle={(d, on) => actuate.mutate({ device: d, on })}
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
	water,
	spaMode,
	heaters,
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
	water: PoolDevice | undefined;
	spaMode: boolean;
	heaters: PoolDevice[];
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
		<div className="space-y-4">
			<PoolSpaHero
				celsius={celsius}
				heater={heaters.find((h) =>
					spaMode ? h.name.startsWith("spa") : h.name.startsWith("pool"),
				)}
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
			/>

			{/* Zones are not relays, so they sit outside the loop below — the
			    panel lists them separately and so does this. */}
			{iclZones.map((zone) => (
				<IclHero key={zone.zoneId} onChange={onIclChange} zone={zone} />
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
		</div>
	);
}

/**
 * One card for both bodies, with the spa pump as the swap.
 * The panel only reports a temperature for whichever body is circulating, so
 * flipping this changes which reading exists at all — not just which is shown.
 */
function PoolSpaHero({
	water,
	spaMode,
	celsius,
	spaPump,
	cover,
	solar,
	freezing,
	hpmFault,
	chem,
	heater,
	setPoint,
	onToggle,
	onSetPoint,
}: {
	water: PoolDevice | undefined;
	spaMode: boolean;
	celsius: boolean;
	spaPump: PoolDevice | undefined;
	cover: PoolDevice | undefined;
	solar: PoolDevice | undefined;
	freezing: boolean;
	hpmFault: string;
	chem: Chem;
	heater: PoolDevice | undefined;
	setPoint: PoolDevice | undefined;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetPoint: (temp: number) => void;
}) {
	const target = Number(setPoint?.value);
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
							{water?.value ?? "—"}
						</span>
						<span className="text-2xl text-muted">{water?.unit ?? "°"}</span>
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
							offIcon={Waves}
							offLabel="Pool"
							onIcon={Bubbles}
							onLabel="Spa"
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
							onToggle={onToggle}
							tone="danger"
						/>
					) : null}
					{/* A cover belongs to the pool, so it keeps to that side of the
					    swap — and only when the panel says one is fitted. */}
					{!spaMode && isReported(cover) ? (
						<TrackSwitch
							device={cover}
							offIcon={Blinds}
							offLabel="Cover"
							onIcon={Blinds}
							onLabel="Cover"
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
	onToggle,
	onColor,
}: {
	device: PoolDevice;
	onToggle: (on: boolean) => void;
	onColor: (effectId: number) => void;
}) {
	const [picked, setPicked] = useState<string | null>(null);
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

				<TrackSwitch
					device={device}
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
				{effects.map((name) => {
					const stops = WATERCOLOR_STOPS[name] ?? [];
					return (
						<Button
							aria-pressed={picked === name}
							className="w-full justify-start text-xs"
							key={name}
							// Effect ids start at 1 and 0 is "off", so setting one turns the
							// light on as well — no separate toggle, which would race the
							// colour with a plain on command.
							onPress={() => {
								setPicked(name);
								onColor(JANDY_WATERCOLORS[name]);
							}}
							size="sm"
							// Filled while this effect is the one running — but only while
							// the light is actually on, or an off light would still look
							// like it had a colour selected.
							variant={picked === name && device.on ? "primary" : "tertiary"}
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
							{name}
						</Button>
					);
				})}
			</div>
		</Card>
	);
}
