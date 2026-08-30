import { Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Thermometer } from "lucide-react";
import { EquipmentRow, IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { PumpSpeeds } from "#/components/pump-speeds";
import {
	type TempRange,
	TempStepper,
	tempRange,
} from "#/components/temp-stepper";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useSetTemps } from "#/lib/queries";
import { usePool, useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/equipment")({
	component: Equipment,
});

function Equipment() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const { controls, heaters, poolSet, spaSet, loading, celsius } =
		usePool(serial);
	const actuate = useActuate(serial);
	const setTemps = useSetTemps(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	// set_temps needs both values in one request, so each control sends the
	// other body's current value alongside its own change.
	const spa = (t: number) =>
		setTemps.mutate({ spa: String(t), pool: poolSet?.value ?? "" });
	const pool = (t: number) =>
		setTemps.mutate({ spa: spaSet?.value ?? "", pool: String(t) });

	const spaHeater = heaters.find((h) => h.name.startsWith("spa"));
	const poolHeater = heaters.find((h) => h.name.startsWith("pool"));
	// Circulation and mode lead; everything else keeps the panel's own order.
	const filterPump = controls.find((d) => d.name === "pool_pump");
	const spaPump = controls.find((d) => d.name === "spa_pump");
	const lead = new Set(["pool_pump", "spa_pump"]);
	const rest = controls.filter((d) => !lead.has(d.name));

	if (controls.length === 0 && heaters.length === 0 && !spaSet && !poolSet) {
		return (
			<Card className="text-sm text-muted">
				No controllable equipment found.
			</Card>
		);
	}

	return (
		<div className="space-y-4">
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

			{poolHeater ? (
				<EquipmentRow
					device={poolHeater}
					onToggle={(on) => actuate.mutate({ device: poolHeater, on })}
				/>
			) : null}
			{poolSet ? (
				<TempRow
					device={poolSet}
					onChange={pool}
					range={tempRange("pool", celsius)}
					title="Pool Temp"
				/>
			) : null}

			{spaHeater ? (
				<EquipmentRow
					device={spaHeater}
					onToggle={(on) => actuate.mutate({ device: spaHeater, on })}
				/>
			) : null}
			{spaSet ? (
				<TempRow
					device={spaSet}
					onChange={spa}
					range={tempRange("spa", celsius)}
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
}: {
	title: string;
	device: PoolDevice;
	range: TempRange;
	onChange: (temp: number) => void;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={false}>
					<Thermometer className="size-4" />
				</IconCircle>
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
