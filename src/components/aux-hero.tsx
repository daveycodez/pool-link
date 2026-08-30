import { Button, Card } from "@heroui/react";
import { Power } from "lucide-react";
import { pumpForDevice } from "#/lib/aqualink/client";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useSetVspSpeed, useVspPumps } from "#/lib/queries";
import { DeviceIcon } from "./device-row";
import { presetIcon } from "./preset-icons";
import { TrackSwitch } from "./track-switch";

/**
 * One aux relay, whatever it happens to be. Same shape as the light hero: the
 * label and its switch on top, and underneath whatever extra control the relay
 * turns out to support. The panel supplies the label, and the speeds appear
 * only when a variable-speed pump drives this relay — so this file knows
 * nothing about jets, waterfalls or cleaners.
 */
export function AuxHero({
	serial,
	device,
	onToggle,
}: {
	serial: string;
	device: PoolDevice;
	onToggle: (on: boolean) => void;
}) {
	const { data: pumps } = useVspPumps(serial);
	const setSpeed = useSetVspSpeed(serial);
	const pump = pumpForDevice(pumps, device.name);
	// The relay's own icon in the thumb, so the switch says what it switches.
	// Unnamed relays have nothing to show, and fall back to a power symbol.
	const Thumb = presetIcon(device.label) ?? Power;
	const active = pump?.speeds.find((s) => s.active);
	// A pump started by a speed command runs without ever closing its relay,
	// so the relay alone under-reports. Running is either signal: the relay
	// closed, or the panel reporting an active speed on the vsp screen.
	const running = device.on || Boolean(pump?.running);

	return (
		<Card className="p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex h-6 items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted">
						<span className="text-accent">
							<DeviceIcon device={device} />
						</span>
						{device.label}
					</div>
				</div>

				<TrackSwitch
					device={pump ? { ...device, on: running } : device}
					offIcon={Thumb}
					offLabel="Off"
					onIcon={Thumb}
					onLabel="On"
					onToggle={(_d, on) => {
						// Turning this pump on IS setting a speed: the command
						// carries on_off_action "on", so one request closes the
						// relay and lands the pump on its last speed — or its
						// first, when none is known. Only here: the equipment
						// page's switch stays a bare relay toggle.
						const speed = pump && (active ?? pump.speeds[0]);
						if (on && pump && speed)
							setSpeed.mutate({ pumpId: pump.pumpId, speedId: speed.id });
						else onToggle(on);
					}}
				/>
			</div>

			{/* Two per row, matching the light hero — speed names vary in length,
			    and equal widths keep the block from looking ragged. */}
			{pump ? (
				<div className="grid grid-cols-2 gap-2">
					{pump.speeds.map((speed) => (
						<Button
							className="w-full justify-start text-xs"
							key={speed.id}
							onPress={() =>
								setSpeed.mutate({ pumpId: pump.pumpId, speedId: speed.id })
							}
							size="sm"
							// A speed is a setting that outlives being switched off, so
							// the selection stays visible either way — but primary is
							// reserved for a speed that is actually driving water, and a
							// stopped pump dims its selection to secondary.
							variant={
								speed.id === active?.id
									? running
										? "primary"
										: "secondary"
									: "tertiary"
							}
						>
							<span className="truncate">{speed.name}</span>
						</Button>
					))}
				</div>
			) : null}
		</Card>
	);
}
