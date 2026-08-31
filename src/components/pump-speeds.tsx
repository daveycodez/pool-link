import { Card, Description, Label, ListBox, Select } from "@heroui/react";
import { Gauge } from "lucide-react";
import type { VspPump } from "#/lib/aqualink/client";
import { useSetVspSpeed, useSpeedUnit, useVspPumps } from "#/lib/queries";
import { CardColumns } from "./card-columns";
import { IconCircle } from "./device-row";

/**
 * Speed control for every variable-speed pump the panel reports. Nothing here
 * is specific to this pool: the panel says which slots have a pump wired to
 * them and what speeds each one holds, and a row is drawn for each.
 */
export function PumpSpeeds({ serial }: { serial: string }) {
	const { data: pumps } = useVspPumps(serial);
	const setSpeed = useSetVspSpeed(serial);

	// Single-speed equipment reports no pumps, and the section simply vanishes.
	if (!pumps?.length) return null;

	return (
		<div className="space-y-4">
			<h2 className="px-1 text-sm font-medium text-muted">Pump Speeds</h2>
			<CardColumns>
				{pumps.map((pump) => (
					<Card
						className="flex-row items-center justify-between gap-4"
						key={pump.pumpId}
					>
						<div className="flex items-center gap-4">
							<IconCircle on={pump.running}>
								<Gauge className="size-4" />
							</IconCircle>
							<Card.Title>{pump.name}</Card.Title>
						</div>
						<PumpSpeedSelect
							onSelect={(speedId) =>
								setSpeed.mutate({ pumpId: pump.pumpId, speedId })
							}
							pump={pump}
							serial={serial}
						/>
					</Card>
				))}
			</CardColumns>
		</div>
	);
}

function PumpSpeedSelect({
	serial,
	pump,
	onSelect,
	className = "w-40",
}: {
	serial: string;
	pump: VspPump;
	onSelect: (speedId: number) => void;
	className?: string;
}) {
	const active = pump.speeds.find((s) => s.active);
	// Not every pump counts speed in RPM. A flow pump reports its presets in
	// gallons per minute over a range a tenth the size, so a hardcoded "RPM"
	// here printed "45 RPM" at somebody whose pump was doing 45 GPM — a label
	// that is wrong by a factor of sixty and reads as a broken pump.
	const unit = useSpeedUnit(serial, pump.pumpId);

	return (
		<Select
			aria-label={`${pump.name} speed`}
			className={className}
			onChange={(value) => {
				if (value != null) onSelect(Number(value));
			}}
			placeholder="Set speed"
			value={active ? String(active.id) : null}
			variant="secondary"
		>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{pump.speeds.map((speed) => (
						<ListBox.Item
							id={String(speed.id)}
							key={speed.id}
							textValue={speed.name}
						>
							<div className="flex flex-col">
								<Label>{speed.name}</Label>
								<Description className="tabular-nums">
									{speed.rpm} {unit}
								</Description>
							</div>
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
