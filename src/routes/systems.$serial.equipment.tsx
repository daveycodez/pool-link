import { Card, ListBox, Select, Switch } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Heater as HeatPumpIcon, Snowflake, Thermometer } from "lucide-react";
import { CardColumns } from "#/components/card-columns";
import { EquipmentRow, IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { PumpSpeeds } from "#/components/pump-speeds";
import {
	type TempRange,
	TempStepper,
	tempRange,
} from "#/components/temp-stepper";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useHeatPump, useSetPoint } from "#/lib/queries";
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
		loading,
		celsius,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setPoint = useSetPoint(serial);
	const heatPumpM = useHeatPump(serial);

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

				{rest.map((d) => (
					<EquipmentRow
						key={d.id}
						device={d}
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
