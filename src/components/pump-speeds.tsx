import { Card, Description, Label, ListBox, Select } from "@heroui/react";
import { Gauge } from "lucide-react";
import type { VspPump } from "#/lib/aqualink/client";
import { useSetVspSpeed, useVspPumps } from "#/lib/queries";
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
			{pumps.map((pump) => (
				<PumpRow
					key={pump.pumpId}
					onSelect={(speedId) =>
						setSpeed.mutate({ pumpId: pump.pumpId, speedId })
					}
					pump={pump}
				/>
			))}
		</div>
	);
}

function PumpRow({
	pump,
	onSelect,
}: {
	pump: VspPump;
	onSelect: (speedId: number) => void;
}) {
	const active = pump.speeds.find((s) => s.active);

	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={Boolean(active)}>
					<Gauge className="size-4" />
				</IconCircle>
				<Card.Title>{pump.name}</Card.Title>
			</div>
			<Select
				aria-label={`${pump.name} speed`}
				className="w-40"
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
										{speed.rpm} RPM
									</Description>
								</div>
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
		</Card>
	);
}
