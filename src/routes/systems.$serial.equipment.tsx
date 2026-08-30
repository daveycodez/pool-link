import { Card, NumberField } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Thermometer } from "lucide-react";
import { EquipmentRow, IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useSetTemps } from "#/lib/queries";
import { usePool, useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/equipment")({
	component: Equipment,
});

/** Ranges the panel accepts, and the granularity it steps in. */
const SPA_RANGE = { min: 98, max: 104, step: 1 };
const POOL_RANGE = { min: 78, max: 88, step: 2 };

function Equipment() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const { controls, heaters, poolSet, spaSet, loading } = usePool(serial);
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
	const busy = actuate.isPending || setTemps.isPending;

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
					busy={busy}
					device={filterPump}
					onToggle={(on) => actuate.mutate({ device: filterPump, on })}
				/>
			) : null}

			{spaPump ? (
				<EquipmentRow
					busy={busy}
					device={spaPump}
					onToggle={(on) => actuate.mutate({ device: spaPump, on })}
				/>
			) : null}

			{poolHeater ? (
				<EquipmentRow
					busy={busy}
					device={poolHeater}
					onToggle={(on) => actuate.mutate({ device: poolHeater, on })}
				/>
			) : null}
			{poolSet ? (
				<TempRow
					busy={busy}
					device={poolSet}
					onChange={pool}
					range={POOL_RANGE}
					title="Pool Temp"
				/>
			) : null}

			{spaHeater ? (
				<EquipmentRow
					busy={busy}
					device={spaHeater}
					onToggle={(on) => actuate.mutate({ device: spaHeater, on })}
				/>
			) : null}
			{spaSet ? (
				<TempRow
					busy={busy}
					device={spaSet}
					onChange={spa}
					range={SPA_RANGE}
					title="Spa Temp"
				/>
			) : null}

			{rest.map((d) => (
				<EquipmentRow
					key={d.id}
					device={d}
					busy={busy}
					onToggle={(on) => actuate.mutate({ device: d, on })}
				/>
			))}
		</div>
	);
}

/** A set point as a stepper, in the same row shape as every other control. */
function TempRow({
	title,
	device,
	range,
	busy,
	onChange,
}: {
	title: string;
	device: PoolDevice;
	range: { min: number; max: number; step: number };
	busy: boolean;
	onChange: (temp: number) => void;
}) {
	const value = Number(device.value);

	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={false}>
					<Thermometer className="size-4" />
				</IconCircle>
				<Card.Title>{title}</Card.Title>
			</div>
			<NumberField
				aria-label={title}
				className="w-fit"
				isDisabled={busy || !Number.isFinite(value)}
				maxValue={range.max}
				minValue={range.min}
				onChange={onChange}
				step={range.step}
				value={value}
				variant="secondary"
			>
				<NumberField.Group>
					<NumberField.DecrementButton />
					<NumberField.Input className="w-14 text-center" />
					<NumberField.IncrementButton />
				</NumberField.Group>
			</NumberField>
		</Card>
	);
}
