import { Card, ListBox, Select, Switch } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import {
	FlaskConical,
	Heater as HeatPumpIcon,
	Snowflake,
	Sparkles,
	Thermometer,
} from "lucide-react";
import { CardColumns } from "#/components/card-columns";
import { EquipmentRow, IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { PumpSpeeds } from "#/components/pump-speeds";
import {
	type TempRange,
	TempStepper,
	tempRange,
} from "#/components/temp-stepper";
import type { SwcConfig } from "#/lib/aqualink/client";
import {
	SWC_BOOST_HOURS,
	SWC_PERCENT_STEP,
	SWC_STATUS_LABELS,
} from "#/lib/aqualink/enums";
import type { PoolDevice, SaltCell } from "#/lib/iaqualink/types";
import {
	useActuate,
	useHeatPump,
	useSetDimmer,
	useSetPoint,
	useSwcBoost,
	useSwcOutput,
} from "#/lib/queries";
import {
	isHidden,
	isReported,
	usePool,
	useRequireSession,
} from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/equipment")({
	component: Equipment,
});

function Equipment() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const {
		controls,
		heaters,
		poolSet,
		spaSet,
		poolChill,
		heatPump,
		saltCell,
		swc,
		loading,
		celsius,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setPoint = useSetPoint(serial);
	const heatPumpM = useHeatPump(serial);
	const swcOutput = useSwcOutput(serial);
	const swcBoost = useSwcBoost(serial);
	const setDimmer = useSetDimmer(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	// Which command carries a set point depends on the equipment, so the hook
	// decides — the page only says which one moved.
	const commit = (name: string) => (value: number) =>
		setPoint.mutate({ name, value });

	const spaHeater = heaters.find((h) => h.name.startsWith("spa"));
	const poolHeater = heaters.find((h) => h.name.startsWith("pool"));
	// Circulation and mode lead; everything else keeps the panel's own order.
	// Fixed keys are in the payload whether or not the hardware exists — an
	// absent solar heater or cover reports "", not nothing — so a row for one
	// would be a switch that does nothing. The panel reporting a state is what
	// says the equipment is there.
	const fitted = controls.filter((d) => isReported(d) && !isHidden(d));
	const filterPump = fitted.find((d) => d.name === "pool_pump");
	const spaPump = fitted.find((d) => d.name === "spa_pump");
	const lead = new Set(["pool_pump", "spa_pump"]);
	const rest = fitted.filter((d) => !lead.has(d.name));
	// Whether this pad plumbs a spa at all. It matters here more than elsewhere:
	// the chlorinator write carries both set points always, so a spa row on a
	// pool-only pad would be a control over water that does not exist — while
	// the panel's own spa value, echoed straight back, changes nothing.
	const hasSpa =
		isReported(spaSet) || isReported(spaPump) || saltCell?.spaOutput != null;
	const cellStatus = saltCell ? cellSummary(saltCell) : "";

	if (fitted.length === 0 && heaters.length === 0 && !spaSet && !poolSet) {
		return (
			<Card className="text-sm text-muted">
				No controllable equipment found.
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<CardColumns>
				{/* Ordered by dependency, not by the API's key order: circulation first,
			    since nothing else works without it, then each heater paired with the
			    temperature it targets, then whatever else the panel exposes. */}
				{filterPump ? (
					<EquipmentRow
						device={filterPump}
						onToggle={(on) => actuate.mutate({ device: filterPump, on })}
					/>
				) : null}

				{spaPump ? (
					<EquipmentRow
						device={spaPump}
						onToggle={(on) => actuate.mutate({ device: spaPump, on })}
					/>
				) : null}

				{isReported(poolHeater) ? (
					<EquipmentRow
						device={poolHeater}
						onToggle={(on) => actuate.mutate({ device: poolHeater, on })}
					/>
				) : null}
				{isReported(poolSet) ? (
					<TempRow
						device={poolSet}
						onChange={commit("pool_set_point")}
						range={tempRange(celsius)}
						title="Pool Temp"
					/>
				) : null}

				{/* The cooling target sits with the heating one, both being pool
			    targets — read-only, since no command in the p-api writes it.
			    Shown whether or not the panel reports a value: this page is the
			    inventory, and it hides nothing. */}
				{isReported(poolChill) ? (
					<TempRow
						device={poolChill}
						icon={<Snowflake className="size-4" />}
						onChange={commit("pool_chill_set_point")}
						range={tempRange(celsius)}
						title="Pool Chill"
					/>
				) : null}

				{isReported(spaHeater) ? (
					<EquipmentRow
						device={spaHeater}
						onToggle={(on) => actuate.mutate({ device: spaHeater, on })}
					/>
				) : null}
				{heatPump ? (
					<Card className="flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<IconCircle on={heatPump.on}>
								<HeatPumpIcon className="size-4" />
							</IconCircle>
							<div className="min-w-0">
								<Card.Title>Heat Pump</Card.Title>
								{heatPump.type ? (
									<Card.Description>{heatPump.type}</Card.Description>
								) : null}
							</div>
						</div>
						<Switch
							aria-label="Heat pump"
							isSelected={heatPump.on}
							onChange={(on) => heatPumpM.mutate({ kind: "power", on })}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</Card>
				) : null}

				{/* Only pumps that can chill offer the choice; a heat-only unit has
			    nothing to switch between. */}
				{heatPump?.chillAvailable ? (
					<Card className="flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<IconCircle on={heatPump.mode === "chill"}>
								<Snowflake className="size-4" />
							</IconCircle>
							<Card.Title>Heat Pump Mode</Card.Title>
						</div>
						<Select
							aria-label="Heat pump mode"
							className="w-32"
							onChange={(v) =>
								v != null && heatPumpM.mutate({ kind: "mode", mode: String(v) })
							}
							value={heatPump.mode || null}
							variant="secondary"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{["heat", "chill"].map((mode) => (
										<ListBox.Item id={mode} key={mode} textValue={mode}>
											<span className="capitalize">{mode}</span>
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</Card>
				) : null}

				{isReported(spaSet) ? (
					<TempRow
						device={spaSet}
						onChange={commit("spa_set_point")}
						range={tempRange(celsius)}
						title="Spa Temp"
					/>
				) : null}

				{/* Chlorination sits after circulation and heating because it depends
				    on the first of them: the cell only produces while the filter pump
				    pushes water past it. Every card below is gated on the panel
				    reporting a paired cell, and a pad without one shows nothing at
				    all — which is most pads. */}
				{saltCell ? (
					<Card className="flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<IconCircle on={isGenerating(saltCell)}>
								<FlaskConical className="size-4" />
							</IconCircle>
							<div className="min-w-0">
								<Card.Title>Salt Cell</Card.Title>
								{cellStatus ? (
									<Card.Description>{cellStatus}</Card.Description>
								) : null}
							</div>
						</div>
					</Card>
				) : null}

				{/* The set points come from a second command, and only the cards that
				    write one wait for it — a panel that rejects get_swc_config keeps
				    the status card above and simply offers no controls, rather than
				    offering a stepper starting from a number nobody reported. */}
				{saltCell && swc ? (
					<OutputRow
						onChange={(value) => swcOutput.mutate({ body: "pool", value })}
						output={saltCell.poolOutput}
						title="Pool Chlorine"
						value={swc.poolSetPoint}
					/>
				) : null}

				{saltCell && swc && hasSpa ? (
					<OutputRow
						onChange={(value) => swcOutput.mutate({ body: "spa", value })}
						output={saltCell.spaOutput}
						title="Spa Chlorine"
						value={swc.spaSetPoint}
					/>
				) : null}

				{/* Not gated on boostDipSwitch, despite how that field reads: per
				    Jandy's own manual it enables the spillover MODE choice in the
				    Boost Setup menu, not boost itself, so hiding the switch for it
				    would take a working control off every pad without spillover. */}
				{saltCell && swc ? (
					<Card className="flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<IconCircle on={swc.boostStatus === "on"}>
								<Sparkles className="size-4" />
							</IconCircle>
							<div className="min-w-0">
								<Card.Title>Boost</Card.Title>
								<Card.Description>{boostSummary(swc)}</Card.Description>
							</div>
						</div>
						<Switch
							aria-label="Chlorinator boost"
							isSelected={swc.boostOn}
							onChange={(on) => swcBoost.mutate(on ? "start" : "stop")}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</Card>
				) : null}

				{/* The relays, whatever they turn out to be. A dimming relay gets a
				    brightness control here and nowhere else — the row itself decides,
				    on the type the panel reported, so a pad with none of them (which
				    is this one) renders exactly the switches it always did. */}
				{rest.map((d) => (
					<EquipmentRow
						key={d.id}
						device={d}
						onDim={(level) => setDimmer.mutate({ device: d, level })}
						onToggle={(on) => actuate.mutate({ device: d, on })}
					/>
				))}

				{/* Speeds sit last: they refine equipment the switches above turn on. */}
			</CardColumns>

			{/* Its own section: these set how equipment above runs rather than
			    whether it runs, and the heading only makes sense over its own
			    cards. It renders nothing at all on a single-speed pad. */}
			<PumpSpeeds serial={serial} />
		</div>
	);
}

/**
 * The chlorinator's output range.
 *
 * Zero to a hundred is the command's own range, and zero means the cell stops
 * producing — a legitimate setting over winter, not a floor to guard against.
 * The step is the interesting part, and it is in enums.ts with its reasoning:
 * the API takes any integer, the hardware underneath often does not.
 */
const OUTPUT_RANGE: TempRange = { min: 0, max: 100, step: SWC_PERCENT_STEP };

/** Statuses that mean the cell is making chlorine right now. */
const GENERATING = new Set(["running", "boosting"]);

/** The panel's wire values are lowercase; these read as prose. */
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");

function isGenerating(cell: SaltCell): boolean {
	return GENERATING.has(cell.poolStatus) || GENERATING.has(cell.spaStatus);
}

/**
 * What the cell is doing, in as many of the three parts as the panel reported.
 * All three are optional by design — this object has never been captured from a
 * panel that pairs a cell, so the card has to read as something sensible when
 * any of it is missing, including all of it.
 */
function cellSummary(cell: SaltCell): string {
	const status = cell.poolStatus || cell.spaStatus;
	return [
		SWC_STATUS_LABELS[status] ?? capitalize(status),
		cell.poolOutput !== null ? `${cell.poolOutput}%` : "",
		// Below its salt floor the cell cannot produce whatever it is set to, so
		// this explains an output of zero that nothing else on the page would.
		cell.lowSalt ? "Low salt" : "",
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * A running boost's countdown, or what starting one would commit to. The
 * circuit is named only where the panel offers a choice of one, since on every
 * other pad it is the only thing boost could mean.
 */
function boostSummary(config: SwcConfig): string {
	const circuit =
		config.boostModeAvailable && config.boostMode
			? capitalize(config.boostMode)
			: "";
	if (!config.boostOn)
		return [`${config.boostHours || SWC_BOOST_HOURS} hours at 100%`, circuit]
			.filter(Boolean)
			.join(" · ");
	const left =
		config.remainingMinutes > 0 ? remainingTime(config.remainingMinutes) : "";
	const state = config.boostStatus === "paused" ? "Paused" : "Running";
	return [state, left && `${left} left`, circuit].filter(Boolean).join(" · ");
}

function remainingTime(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (!h) return `${m}m`;
	return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * One body's chlorine output. The stepper writes the set point; the caption
 * reads what the cell is actually producing, which is a different number — a
 * cell idles at zero while the pump is off however it is set, and a panel that
 * quantises the percent says so here rather than silently.
 */
function OutputRow({
	title,
	value,
	output,
	onChange,
}: {
	title: string;
	value: number;
	/** Live production percent, or null when the panel did not report one. */
	output: number | null;
	onChange: (percent: number) => void;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={(output ?? 0) > 0}>
					<FlaskConical className="size-4" />
				</IconCircle>
				<div className="min-w-0">
					<Card.Title>{title}</Card.Title>
					<Card.Description>
						{output !== null ? `Producing ${output}%` : "Output percent"}
					</Card.Description>
				</div>
			</div>
			<TempStepper
				className="w-fit"
				label={`${title} output percent`}
				onCommit={onChange}
				range={OUTPUT_RANGE}
				value={value}
			/>
		</Card>
	);
}

/** A set point as a stepper, in the same row shape as every other control. */
function TempRow({
	title,
	device,
	range,
	onChange,
	icon = <Thermometer className="size-4" />,
}: {
	title: string;
	device: PoolDevice;
	range: TempRange;
	onChange: (temp: number) => void;
	/** Chill is still a temperature, but not a warm one. */
	icon?: React.ReactNode;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={false}>{icon}</IconCircle>
				<Card.Title>{title}</Card.Title>
			</div>
			<TempStepper
				className="w-fit"
				onCommit={onChange}
				range={range}
				value={Number(device.value)}
			/>
		</Card>
	);
}
