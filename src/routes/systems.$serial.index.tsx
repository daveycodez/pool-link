import { Button, Card, Chip } from "@heroui/react";
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
import { Loading } from "#/components/loading";
import { TempStepper, tempRange } from "#/components/temp-stepper";
import { TrackSwitch } from "#/components/track-switch";
import { JANDY_WATERCOLORS, WATERCOLOR_HEX } from "#/lib/aqualink/enums";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useLightColor, useSetTemps } from "#/lib/queries";
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
		cover,
		solar,
		freezing,
		auxes,
		celsius,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setTemps = useSetTemps(serial);
	const lightColor = useLightColor(serial);

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
			freezing={freezing}
			auxes={auxes}
			celsius={celsius}
			poolSet={poolSet}
			spaSet={spaSet}
			onToggle={(d, on) => actuate.mutate({ device: d, on })}
			onSetTemps={(sp, pl) => setTemps.mutate({ spa: sp, pool: pl })}
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
	auxes,
	celsius,
	poolSet,
	spaSet,
	onToggle,
	onSetTemps,
	onLightColor,
}: {
	water: PoolDevice | undefined;
	spaMode: boolean;
	heaters: PoolDevice[];
	spaPump: PoolDevice | undefined;
	cover: PoolDevice | undefined;
	solar: PoolDevice | undefined;
	freezing: boolean;
	auxes: PoolDevice[];
	celsius: boolean;
	poolSet: PoolDevice | undefined;
	spaSet: PoolDevice | undefined;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetTemps: (spa: string, pool: string) => void;
	onLightColor: (device: PoolDevice, effectId: number) => void;
	serial: string;
}) {
	return (
		<div className="space-y-4">
			<ModeHero
				celsius={celsius}
				heater={heaters.find((h) =>
					spaMode ? h.name.startsWith("spa") : h.name.startsWith("pool"),
				)}
				onSetPoint={(t) =>
					spaMode
						? onSetTemps(String(t), poolSet?.value ?? "")
						: onSetTemps(spaSet?.value ?? "", String(t))
				}
				onToggle={onToggle}
				setPoint={spaMode ? spaSet : poolSet}
				spaMode={spaMode}
				spaPump={spaPump}
				cover={cover}
				solar={solar}
				freezing={freezing}
				water={water}
			/>

			{/* One card per relay, in the panel's own order. A relay that reports
			    as a Jandy colour light gets the effects hero; everything else is
			    a switch, so what appears follows the panel rather than this app. */}
			{auxes.map((aux) =>
				isJandyLight(aux) ? (
					<LightHero
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
	celsius,
	spaPump,
	cover,
	solar,
	freezing,
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
							range={tempRange(spaMode ? "spa" : "pool", celsius)}
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
							offLabel="Solar"
							onIcon={Sun}
							onLabel="Solar"
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
		</Card>
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
				{effects.map((name) => (
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
