import {
	AlertDialog,
	Button,
	Card,
	Chip,
	Description,
	InputGroup,
	Label,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { Pencil, Plug } from "lucide-react";
import { useState } from "react";
import type { VspSlotSetup, VspSpeed } from "#/lib/aqualink/client";
import { errorMessage } from "#/lib/aqualink/types";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useSetAuxSpeed, useSetSpeed } from "#/lib/queries";
import { CardColumns } from "./card-columns";
import { TempStepper } from "./temp-stepper";

/**
 * How far one press of the stepper moves a speed, per unit.
 *
 * Every speed this panel reports is a multiple of fifty RPM — 600, 1250, 2050,
 * 3450 — which is the granularity the pump's own controller is set in, so a
 * stepper moving in ones would take fifty presses to reach the next value
 * anybody would actually choose. Flow pumps count in gallons per minute over a
 * range an order of magnitude smaller, where fifty is most of the usable span
 * and one is the only sensible increment. Nothing in the protocol states either
 * figure; both are read off the values real pumps hold.
 */
const SPEED_STEP: Record<string, number> = { RPM: 50, GPM: 1 };

/** The step for a unit, defaulting to the finest one for a unit nobody named. */
export function speedStep(unit: string): number {
	return SPEED_STEP[unit] ?? 1;
}

/** The aux positions the panel can bind a speed to, named as the owner named them. */
function auxOptions(devices: PoolDevice[], auxCount: number) {
	// Position n of the panel's assignment list is the nth aux the devices
	// screen names — which is `aux_n` for the first seven and then runs into the
	// lettered expansion banks, so the position has to come from the order and
	// never from the name.
	const auxes = devices.filter((d) => d.name.startsWith("aux_"));
	return auxes
		.slice(0, auxCount)
		.map((d, i) => ({ auxId: i + 1, label: d.label }));
}

export function PumpFeatureSpeeds({
	serial,
	slotId,
	setup,
	unit,
	devices,
}: {
	serial: string;
	slotId: number;
	setup: VspSlotSetup;
	unit: string;
	devices: PoolDevice[];
}) {
	const options = auxOptions(devices, setup.auxCount);

	return (
		<div className="space-y-4">
			<h2 className="px-1 text-sm font-medium text-muted">Feature Speeds</h2>
			<CardColumns>
				{setup.speeds.map((speed) => (
					<SpeedCard
						auxOptions={options}
						key={speed.id}
						serial={serial}
						setup={setup}
						slotId={slotId}
						speed={speed}
						unit={unit}
					/>
				))}
			</CardColumns>
		</div>
	);
}

function SpeedCard({
	serial,
	slotId,
	speed,
	setup,
	unit,
	auxOptions: options,
}: {
	serial: string;
	slotId: number;
	speed: VspSpeed;
	setup: VspSlotSetup;
	unit: string;
	auxOptions: { auxId: number; label: string }[];
}) {
	const save = useSetSpeed(serial, slotId);
	const moveAux = useSetAuxSpeed(serial, slotId);

	// Which relay runs this speed today. A speed can appear on more than one aux
	// in principle; the first is what the row shows and what a move releases.
	const currentAux = setup.auxSpeeds.indexOf(speed.id) + 1;
	const currentLabel = options.find((o) => o.auxId === currentAux)?.label;

	const [name, setName] = useState(speed.name);
	const [value, setValue] = useState(speed.rpm);
	const [aux, setAux] = useState(currentAux);

	const open = () => {
		setName(speed.name);
		setValue(speed.rpm);
		setAux(currentAux);
	};

	// Only what moved is sent. Reasserting a name that was already right costs a
	// second command on a line that takes them one at a time, and every command
	// sent is another chance for the panel to reject one.
	const commit = () => {
		const changed = {
			...(name !== speed.name ? { name } : {}),
			...(value !== speed.rpm ? { value } : {}),
		};
		if (Object.keys(changed).length)
			save.mutate({ speedId: speed.id, ...changed });
		if (aux !== currentAux)
			moveAux.mutate({
				speedId: speed.id,
				auxId: aux,
				previousAuxId: currentAux,
			});
	};

	const step = speedStep(unit);
	const error = save.isError ? save.error : moveAux.error;

	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="min-w-0 space-y-1">
				<Card.Title className="truncate">{speed.name}</Card.Title>
				<div className="flex flex-wrap items-center gap-2">
					<Card.Description className="tabular-nums">
						{speed.rpm} {unit}
					</Card.Description>
					{currentLabel ? (
						<Chip size="sm">
							<Plug className="size-3" />
							<Chip.Label>{currentLabel}</Chip.Label>
						</Chip>
					) : null}
				</div>
			</div>

			<AlertDialog>
				<Button
					aria-label={`Edit ${speed.name}`}
					isIconOnly
					onPress={open}
					size="sm"
					variant="ghost"
				>
					<Pencil />
				</Button>
				<AlertDialog.Backdrop>
					<AlertDialog.Container>
						<AlertDialog.Dialog>
							<AlertDialog.Header>
								<AlertDialog.Heading>Edit speed</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body className="space-y-6">
								<TextField
									aria-label="Speed name"
									autoFocus
									fullWidth
									onChange={setName}
									value={name}
									variant="secondary"
								>
									<Label>Name</Label>
									<InputGroup>
										<InputGroup.Input placeholder="Pool" />
									</InputGroup>
								</TextField>

								<div className="flex items-center justify-between gap-4">
									{/* The label and its range are outside a field wrapper, so
									    HeroUI is not spacing them for us. */}
									<div className="flex flex-col gap-1">
										<Label>Speed</Label>
										<Description className="tabular-nums">
											{setup.min}–{setup.max} {unit}
										</Description>
									</div>
									<TempStepper
										inputClassName="w-20 text-center"
										label={`Speed in ${unit}`}
										onCommit={setValue}
										range={{ min: setup.min, max: setup.max, step }}
										value={value}
									/>
								</div>

								<Select
									aria-label="Aux relay"
									onChange={(v) => setAux(v == null ? 0 : Number(v))}
									placeholder="Not assigned"
									value={String(aux)}
									variant="secondary"
								>
									<Label>Runs on</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											<ListBox.Item id="0" textValue="Not assigned">
												<Label>Not assigned</Label>
												<ListBox.ItemIndicator />
											</ListBox.Item>
											{options.map((o) => {
												const held = setup.auxSpeeds[o.auxId - 1];
												const heldBy =
													held && held !== speed.id
														? setup.speeds.find((s) => s.id === held)?.name
														: undefined;
												return (
													<ListBox.Item
														id={String(o.auxId)}
														key={o.auxId}
														textValue={o.label}
													>
														<div className="flex flex-col">
															<Label>{o.label}</Label>
															{heldBy ? (
																<Description>Now runs {heldBy}</Description>
															) : null}
														</div>
														<ListBox.ItemIndicator />
													</ListBox.Item>
												);
											})}
										</ListBox>
									</Select.Popover>
								</Select>

								{error ? (
									<p className="text-xs text-danger" role="alert">
										{errorMessage(error)}
									</p>
								) : null}
							</AlertDialog.Body>
							<AlertDialog.Footer>
								<Button slot="close" variant="tertiary">
									Cancel
								</Button>
								<Button onPress={commit} slot="close">
									Save
								</Button>
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>
			</AlertDialog>
		</Card>
	);
}
