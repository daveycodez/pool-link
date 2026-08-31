import {
	AlertDialog,
	Button,
	Label,
	ListBox,
	Select,
	TimeField,
} from "@heroui/react";
import { Time } from "@internationalized/date";
import { Clock, Gauge, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { presetIcon } from "#/components/preset-icons";
import type {
	Schedule,
	ScheduleDevice,
	ScheduleSpec,
	ScheduleSpeed,
} from "#/lib/aqualink/client";
import { AqualinkError } from "#/lib/aqualink/types";
import {
	DEFAULT_SCHEDULE_DAYS,
	dayLabel,
	isKnownDays,
	isOvernight,
	SCHEDULE_DAYS,
} from "#/lib/schedule";

/**
 * The days a schedule may be given, with whatever the panel already said kept
 * at the front of the list when it is a word this app does not know.
 *
 * A pad's own keypad can hold a value nobody here has seen, and the editor must
 * not be the thing that quietly rewrites it: opening a schedule and pressing
 * Save should send back what was there. So an unrecognised string becomes an
 * option of its own rather than being dropped, which would snap the field to
 * the first entry in the list and change a program the owner only meant to
 * retime.
 */
function dayOptions(current: string): string[] {
	return isKnownDays(current) || !current
		? [...SCHEDULE_DAYS]
		: [current, ...SCHEDULE_DAYS];
}

/**
 * How a device reads in the picker.
 *
 * A pump appears in the panel's list twice under one name — once as the relay
 * that switches it and once as the speeds behind it — so the second needs a
 * word to tell it from the first, or the menu offers "Waterfall" twice and the
 * owner has no way to tell which is which. The panel's own web UI suffixes
 * these "SPD"; this is that, spelled out.
 */
function deviceLabel(device: ScheduleDevice): string {
	return device.isVsp ? `${device.name} Speed` : device.name;
}

/**
 * The equipment menu, with each pump's speeds entry beneath the pump itself.
 *
 * The panel lists them nowhere near each other. It answers with its own
 * ordering — the three speed entries together near the front, the relays they
 * belong to further down — so straight off the wire this menu offered
 * "Waterfall Speed" four rows above "Waterfall", and the pair that an owner
 * thinks of as one piece of equipment read as two unrelated entries.
 *
 * Paired on the name, because that is the only thing tying them: the two ids
 * are unrelated numbers from different ranges, and the panel gives both rows
 * the same name and distinguishes them by a flag alone. Anything left unpaired
 * keeps its place at the end rather than being dropped — a speeds entry whose
 * relay this app cannot see is still somewhere a program can point.
 */
function orderDevices(devices: ScheduleDevice[]): ScheduleDevice[] {
	const key = (d: ScheduleDevice) => d.name.trim().toLowerCase();
	const speeds = devices.filter((d) => d.isVsp);
	const taken = new Set<number>();
	const ordered: ScheduleDevice[] = [];

	for (const device of devices) {
		if (device.isVsp) continue;
		ordered.push(device);
		for (const speed of speeds)
			if (key(speed) === key(device) && !taken.has(speed.id)) {
				ordered.push(speed);
				taken.add(speed.id);
			}
	}
	return [...ordered, ...speeds.filter((s) => !taken.has(s.id))];
}

function errorMessage(error: unknown): string {
	if (error instanceof AqualinkError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

/**
 * The add and edit form, which is one form because a schedule has the same four
 * fields either way — the difference is only whether the panel is told an id.
 *
 * `trigger` is whatever opens it, so a row can be its own button and the Add
 * control can be an ordinary one, without this component having an opinion
 * about either.
 */
export function ScheduleEditor({
	devices,
	error,
	isPending,
	onDelete,
	onSave,
	schedule,
	speeds,
	title,
	trigger,
}: {
	devices: ScheduleDevice[];
	error: unknown;
	isPending: boolean;
	/** Absent for a new schedule: there is nothing yet to remove. */
	onDelete?: () => void;
	onSave: (spec: ScheduleSpec) => void;
	/** The schedule being changed, or undefined when adding one. */
	schedule?: Schedule;
	/** Every speed the panel's pumps offer, for the equipment that has them. */
	speeds: ScheduleSpeed[];
	title: string;
	trigger: React.ReactNode;
}) {
	/**
	 * The equipment field holds a *pump* for a speed program, not the speed.
	 *
	 * Which means unpicking what the panel stores, because it keeps the pair the
	 * other way round: `deviceId` is the speed and `vspId` is the pump that owns
	 * it. A form asking "what does this run, and how fast" wants those in the
	 * order a person would say them, so they are swapped apart here and swapped
	 * back on save. Getting this backwards points a program at equipment nobody
	 * chose, which is why it is done in one place at each end rather than
	 * threaded through the fields.
	 */
	const [deviceId, setDeviceId] = useState(
		schedule?.vspId ?? schedule?.deviceId ?? devices[0]?.id ?? 0,
	);
	const [speedId, setSpeedId] = useState<number | null>(
		schedule?.vspId == null ? null : schedule.deviceId,
	);
	const [days, setDays] = useState(schedule?.days || DEFAULT_SCHEDULE_DAYS);
	const [start, setStart] = useState(
		new Time(schedule?.startHrs ?? 9, schedule?.startMins ?? 0),
	);
	const [stop, setStop] = useState(
		new Time(schedule?.stopHrs ?? 17, schedule?.stopMins ?? 0),
	);

	/**
	 * The speeds belonging to whatever equipment is currently chosen, which is
	 * empty for a relay and is what decides whether the second field exists at
	 * all. A pump with no speeds the panel would name leaves it hidden rather
	 * than showing an empty menu.
	 */
	const pumpSpeeds = speeds.filter((s) => s.pumpId === deviceId);
	const needsSpeed = pumpSpeeds.length > 0;
	const speed = needsSpeed
		? (pumpSpeeds.find((s) => s.id === speedId) ?? pumpSpeeds[0])
		: null;

	const overnight = isOvernight(
		start.hour,
		start.minute,
		stop.hour,
		stop.minute,
	);
	// A window that starts and ends on the same minute is the one shape the
	// panel cannot act on, so it is the one thing this refuses to send.
	const empty = start.hour === stop.hour && start.minute === stop.minute;

	return (
		<AlertDialog>
			{trigger}
			<AlertDialog.Backdrop>
				<AlertDialog.Container>
					<AlertDialog.Dialog>
						<AlertDialog.Header>
							<AlertDialog.Heading>{title}</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<div className="flex flex-col gap-4">
								{/* Secondary throughout, the lower-emphasis variant meant for
								    fields on a raised surface: a dialog is already lifted off
								    the page, and the default carries a shadow of its own that
								    reads as a second layer stacked on the first. */}
								<Select
									onSelectionChange={(key) => {
										// A speed belongs to the pump that was chosen, so it
										// cannot survive choosing a different one. Cleared rather
										// than carried, and the field below reopens on whatever
										// the new equipment offers.
										setDeviceId(Number(key));
										setSpeedId(null);
									}}
									placeholder="Select equipment"
									selectedKey={String(deviceId)}
									variant="secondary"
								>
									<Label>Equipment</Label>
									<Select.Trigger>
										{/* The trigger echoes the chosen item's own contents, so
										    now that an item is an icon beside a name it needs to
										    be laid out as a row — the base rule is a block that
										    breaks words, which put the icon on one line and "Jet
										    Pump" on the next. `min-w-0` with a truncating name so
										    a long one shortens instead of pushing the chevron. */}
										<Select.Value className="flex min-w-0 items-center gap-2" />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{orderDevices(devices).map((d) => {
												// The same mark the row and the equipment page give
												// this device, so the picker is recognisable as a
												// list of the owner's own equipment rather than a
												// list of words. `textValue` stays the bare name, so
												// type-ahead still matches what is written.
												// A pump entry is about how fast, not about what, so
												// it takes the gauge rather than the equipment's own
												// mark — which its plain relay twin is already
												// wearing one line away.
												const Icon = d.isVsp
													? Gauge
													: (presetIcon(d.name) ?? Zap);
												const label = deviceLabel(d);
												return (
													<ListBox.Item
														id={String(d.id)}
														key={d.id}
														textValue={label}
													>
														<Icon className="size-4 shrink-0 text-muted" />
														<span className="truncate">{label}</span>
														<ListBox.ItemIndicator />
													</ListBox.Item>
												);
											})}
										</ListBox>
									</Select.Popover>
								</Select>

								{/* Only for equipment that has speeds, and only once the panel
								    has named them. A pump program is two choices — which pump,
								    then how fast — and the second has nowhere to live until the
								    first is made, so it appears rather than sitting greyed out
								    on every relay that will never use it. */}
								{speed ? (
									<Select
										onSelectionChange={(key) => setSpeedId(Number(key))}
										selectedKey={String(speed.id)}
										variant="secondary"
									>
										<Label>Speed</Label>
										<Select.Trigger>
											<Select.Value />
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{pumpSpeeds.map((s) => (
													<ListBox.Item
														id={String(s.id)}
														key={s.id}
														textValue={s.name}
													>
														{s.name}
														<ListBox.ItemIndicator />
													</ListBox.Item>
												))}
											</ListBox>
										</Select.Popover>
									</Select>
								) : null}

								<Select
									onSelectionChange={(key) => setDays(String(key))}
									selectedKey={days}
									variant="secondary"
								>
									<Label>Days</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{dayOptions(days).map((d) => (
												<ListBox.Item id={d} key={d} textValue={dayLabel(d)}>
													{dayLabel(d)}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>

								<div className="flex gap-3">
									<TimeField
										className="flex-1"
										granularity="minute"
										hourCycle={12}
										onChange={(v) => v && setStart(v)}
										value={start}
									>
										<Label>Start time</Label>
										{/* The lower-emphasis variant, because a dialog is an
										    elevated surface and the default field would sit at
										    the same depth as the thing holding it. */}
										<TimeField.Group variant="secondary">
											<TimeField.Input>
												{(segment) => <TimeField.Segment segment={segment} />}
											</TimeField.Input>
											<TimeField.Suffix>
												<Clock className="size-4 text-muted" />
											</TimeField.Suffix>
										</TimeField.Group>
									</TimeField>
									<TimeField
										className="flex-1"
										granularity="minute"
										hourCycle={12}
										onChange={(v) => v && setStop(v)}
										value={stop}
									>
										<Label>End time</Label>
										<TimeField.Group variant="secondary">
											<TimeField.Input>
												{(segment) => <TimeField.Segment segment={segment} />}
											</TimeField.Input>
											<TimeField.Suffix>
												<Clock className="size-4 text-muted" />
											</TimeField.Suffix>
										</TimeField.Group>
									</TimeField>
								</div>

								{/* Said before it is saved rather than only in the list
								    afterwards. A stop time earlier than the start is how an
								    overnight program is written, and it is also exactly what a
								    typo looks like — so the form states which one it thinks
								    this is while there is still a chance to correct it. */}
								{overnight ? (
									<p className="text-xs text-muted">
										Runs overnight, ending the next morning.
									</p>
								) : null}
								{empty ? (
									<p className="text-xs text-danger" role="alert">
										Start and stop are the same time.
									</p>
								) : null}
								{error ? (
									<p className="text-xs text-danger" role="alert">
										{errorMessage(error)}
									</p>
								) : null}
							</div>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							{/* The soft danger variant, not a solid one: destructive, but
							    subordinate to Save, which is the primary action here. Pushed
							    to the far side so it is never adjacent to the button most
							    people came to press. */}
							{onDelete ? (
								<Button
									className="me-auto"
									isDisabled={isPending}
									onPress={onDelete}
									slot="close"
									variant="danger-soft"
								>
									<Trash2 className="size-4" />
									Delete
								</Button>
							) : null}
							<Button slot="close" variant="tertiary">
								Cancel
							</Button>
							<Button
								isDisabled={isPending || empty || !deviceId}
								onPress={() =>
									onSave({
										// Swapped back into the panel's own arrangement — the
										// speed in deviceId, its pump in vspId — which is the
										// reverse of how the form asks for them.
										deviceId: speed ? speed.id : deviceId,
										startHrs: start.hour,
										startMins: start.minute,
										stopHrs: stop.hour,
										stopMins: stop.minute,
										days,
										vspId: speed ? deviceId : null,
									})
								}
								slot="close"
							>
								Save
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}
