import {
	AlertDialog,
	Button,
	Label,
	ListBox,
	Select,
	TimeField,
} from "@heroui/react";
import { Time } from "@internationalized/date";
import { Clock, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { presetIcon } from "#/components/preset-icons";
import type {
	Schedule,
	ScheduleDevice,
	ScheduleSpec,
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
	title: string;
	trigger: React.ReactNode;
}) {
	const [deviceId, setDeviceId] = useState(
		schedule?.deviceId ?? devices[0]?.id ?? 0,
	);
	const [days, setDays] = useState(schedule?.days || DEFAULT_SCHEDULE_DAYS);
	const [start, setStart] = useState(
		new Time(schedule?.startHrs ?? 9, schedule?.startMins ?? 0),
	);
	const [stop, setStop] = useState(
		new Time(schedule?.stopHrs ?? 17, schedule?.stopMins ?? 0),
	);

	/**
	 * Whether this program runs a pump speed rather than a relay.
	 *
	 * Such a program is addressed by two ids — the speed in `deviceId` and its
	 * pump in `vspId` — and this form can only offer the one list. So the
	 * equipment field is fixed for it, and the pair is carried back untouched on
	 * save: the times and the days are still the owner's to change, and what
	 * they must not do by accident is have the speed silently rewritten into a
	 * device number that means nothing without its pump. Offering the speeds
	 * properly is a feature; quietly breaking one is a bug.
	 */
	const speedProgram = schedule?.vspId != null;

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
									isDisabled={speedProgram}
									onSelectionChange={(key) => setDeviceId(Number(key))}
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
											{devices.map((d) => {
												// The same mark the row and the equipment page give
												// this device, so the picker is recognisable as a
												// list of the owner's own equipment rather than a
												// list of words. `textValue` stays the bare name, so
												// type-ahead still matches what is written.
												const Icon = presetIcon(d.name) ?? Zap;
												return (
													<ListBox.Item
														id={String(d.id)}
														key={d.id}
														textValue={d.name}
													>
														<Icon className="size-4 shrink-0 text-muted" />
														<span className="truncate">{d.name}</span>
														<ListBox.ItemIndicator />
													</ListBox.Item>
												);
											})}
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
										deviceId,
										startHrs: start.hour,
										startMins: start.minute,
										stopHrs: stop.hour,
										stopMins: stop.minute,
										days,
										vspId: schedule?.vspId ?? null,
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
