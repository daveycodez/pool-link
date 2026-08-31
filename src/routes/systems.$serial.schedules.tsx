import { Button, Card, Chip } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Gauge, Pencil, Plus, Zap } from "lucide-react";
import { useMemo } from "react";
import { CardColumns } from "#/components/card-columns";
import { IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { presetIcon } from "#/components/preset-icons";
import { ScheduleEditor } from "#/components/schedule-editor";
import type {
	Schedule,
	ScheduleDevice,
	ScheduleSpec,
	ScheduleSpeed,
} from "#/lib/aqualink/client";
import {
	useAddSchedule,
	useDeleteSchedule,
	useEditSchedule,
	useScheduleDevices,
	useScheduleSpeeds,
	useSchedules,
} from "#/lib/queries";
import { dayLabel, isOvernight, windowLabel } from "#/lib/schedule";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/schedules")({
	component: Schedules,
});

/**
 * Oldest program first, which is the order the panel's own app shows and so the
 * order an owner can cross-reference against it.
 *
 * The id is what carries that: the panel counts up as programs are made, so
 * ascending id is the order they were created in. It has to be sorted for
 * rather than taken as it arrives — this pool listed its six as 0, 1, 2, 4, 3,
 * 5, so the reply is in some storage order of the pad's own and not in this
 * one.
 *
 * The id is only a proxy for age, not a record of it. Nothing timestamps a
 * schedule, and a panel that reuses the ids of deleted programs would seat a
 * new one wherever the gap was. That is the right trade anyway: matching what
 * the other app shows is worth more here than being defensibly chronological
 * on a pad nobody can check against.
 */
function byAge(a: Schedule, b: Schedule): number {
	return a.id - b.id;
}

/**
 * What a schedule's equipment is called.
 *
 * The join the whole page rests on: a schedule names an id out of the master
 * device list and nothing else, so without this every row would read "device
 * 12". An id the list does not describe still gets a row — a program that
 * exists is worth showing even unnamed, and saying so is more use than hiding
 * it.
 */
function deviceName(id: number, devices: ScheduleDevice[]): string {
	return devices.find((d) => d.id === id)?.name ?? `Device ${id}`;
}

/**
 * What a program runs, in the two words an owner would use for it.
 *
 * A program against a relay names it directly. A program against a pump speed
 * names two things and neither is where you would expect: the speed sits in
 * `deviceId` and the pump in `vspId`, so reading such a row the ordinary way
 * looks up a speed id in the device list, finds nothing, and calls it "Device
 * 110". The speed table is the other half of the answer, and it is fetched
 * separately because it costs a request per pump.
 *
 * Either half can be missing — a table still loading, a pad that would not
 * answer for one pump — and a number stands in when it is. A program the app
 * cannot fully name is still a program that runs equipment, and saying "Speed
 * 110" out loud is more use than hiding it.
 */
function scheduleTarget(
	schedule: Schedule,
	devices: ScheduleDevice[],
	speeds: ScheduleSpeed[],
): { name: string; speed: string | null } {
	if (schedule.vspId == null)
		return { name: deviceName(schedule.deviceId, devices), speed: null };
	return {
		name: deviceName(schedule.vspId, devices),
		speed:
			speeds.find((s) => s.id === schedule.deviceId)?.name ??
			`Speed ${schedule.deviceId}`,
	};
}

function Schedules() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const schedules = useSchedules(serial);
	const devices = useScheduleDevices(serial);
	const pumps = useMemo(
		() => (devices.data ?? []).filter((d) => d.isVsp),
		[devices.data],
	);
	const speeds = useScheduleSpeeds(serial, pumps);
	const add = useAddSchedule(serial);
	const edit = useEditSchedule(serial);
	const remove = useDeleteSchedule(serial);

	if (pending || schedules.isPending) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	/**
	 * A panel that cannot answer the command at all, which is a different fact
	 * from one with no programs and has to read differently. `getScheduleList`
	 * throws rather than returning an empty list for exactly this case, so that
	 * "this panel does not do schedules" never renders as "you have none".
	 */
	if (schedules.isError)
		return (
			<Card className="text-sm text-muted">
				This panel did not answer for schedules. Its programs, if it has any,
				are reachable from the panel's own web page.
			</Card>
		);

	const list = schedules.data;
	const known = devices.data ?? [];
	const knownSpeeds = speeds.data ?? [];
	const rows = [...(list?.schedules ?? [])].sort(byAge);

	/**
	 * What a new schedule may be pointed at.
	 *
	 * The pump slots are held back, though no longer for want of knowing how
	 * they work. `listType=1` lists them alongside the relays — the same
	 * equipment appears twice, once plain and once with `isVSP` set — and a
	 * program against one is written speed-in-`deviceId`, pump-in-`vspId`. What
	 * is missing is the rest of the form: choosing a pump means then choosing
	 * one of its speeds, and a picker that offered the pump alone would be
	 * asking for half an answer. Existing speed programs still list and still
	 * take a new time, so nothing here is unreachable — only unaddable.
	 */
	const schedulable = known.filter((d) => !d.isVsp);

	const addButton = list?.canAdd ? (
		<ScheduleEditor
			devices={schedulable}
			error={add.error}
			isPending={add.isPending}
			onSave={(spec) => add.mutate(spec)}
			title="New schedule"
			trigger={
				// Solid, which is the default: adding a program is what this page is
				// for, and a solid fill is reserved for exactly that. The equipment
				// rows around it carry no competing call to action.
				<Button isDisabled={schedulable.length === 0}>
					<Plus className="size-4" />
					Add schedule
				</Button>
			}
		/>
	) : null;

	/**
	 * The add control, below the columns rather than dealt into them.
	 *
	 * Being one of the columns' own children was tried and is worse. They are
	 * filled sequentially by a count taken from how many children there are, so
	 * a button among them is a card as far as that arithmetic goes: four
	 * schedules split evenly two and two, but four schedules and a button split
	 * three and two — putting three cards against one. Closing the ragged edge
	 * on an odd count cost a much worse imbalance on every even one.
	 *
	 * So it sits under the pair, and on an odd count there is white space above
	 * it where the short column ran out. That is the columns ending unevenly,
	 * which they do whenever the cards are of differing heights anyway; it is
	 * not something this button can fix by standing somewhere else.
	 */
	const addRow = addButton ? (
		<div className="flex justify-end">{addButton}</div>
	) : null;

	if (rows.length === 0)
		return (
			<div className="space-y-4">
				<Card className="text-sm text-muted">
					This panel is running no schedules.
				</Card>
				{addRow}
			</div>
		);

	return (
		<div className="space-y-4">
			<CardColumns>
				{rows.map((schedule) => (
					<ScheduleRow
						devices={known}
						schedulable={schedulable}
						speeds={knownSpeeds}
						editError={edit.error}
						isPending={edit.isPending || remove.isPending}
						key={schedule.id}
						onDelete={() => remove.mutate(schedule.id)}
						onSave={(spec) => edit.mutate({ id: schedule.id, spec })}
						schedule={schedule}
					/>
				))}
			</CardColumns>

			{addRow}
		</div>
	);
}

function ScheduleRow({
	devices,
	editError,
	isPending,
	onDelete,
	onSave,
	schedulable,
	schedule,
	speeds,
}: {
	/** Everything the panel can name, which is what a row is titled from. */
	devices: ScheduleDevice[];
	editError: unknown;
	isPending: boolean;
	onDelete: () => void;
	onSave: (spec: ScheduleSpec) => void;
	/** The narrower set a schedule may be pointed at — see `schedulable`. */
	schedulable: ScheduleDevice[];
	schedule: Schedule;
	/** Every pump speed the panel named, for the programs that run one. */
	speeds: ScheduleSpeed[];
}) {
	const { name, speed } = scheduleTarget(schedule, devices, speeds);
	const overnight = isOvernight(
		schedule.startHrs,
		schedule.startMins,
		schedule.stopHrs,
		schedule.stopMins,
	);
	/**
	 * The same mark the equipment page gives this device, so a schedule for the
	 * waterfall is recognisable as the waterfall rather than as a generic entry
	 * in a list. It works because both sides are reading the panel's own
	 * vocabulary: `presetIcon` matches the fixed names a relay can be given, and
	 * the master device list names equipment from that same list.
	 *
	 * The fallback is the bolt `DeviceIcon` ends on for the same reason — a name
	 * with no preset behind it, or an id the device list did not describe. It
	 * stays the equipment page's answer to "something, but nothing more
	 * specific" rather than becoming a mark that means "schedule", which every
	 * row here would equally deserve and none would be told apart by.
	 */
	const Icon = presetIcon(name) ?? Zap;

	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-4">
				<IconCircle on>
					<Icon className="size-4" />
				</IconCircle>
				{/* Three lines about one program, so they are set as a block rather
				    than as separate facts: the card's own leading is sized for a title
				    standing alone above a description, and at three deep it reads as a
				    list of unrelated things. */}
				<div className="min-w-0">
					<Card.Title className="leading-5">{name}</Card.Title>
					<Card.Description className="text-xs leading-4 tabular-nums">
						{windowLabel(
							schedule.startHrs,
							schedule.startMins,
							schedule.stopHrs,
							schedule.stopMins,
						)}
					</Card.Description>
					<div className="mt-1.5 flex flex-wrap items-center gap-2">
						{/* Only the narrower selections carry accent: a program that runs
						    every day is the ordinary case and should not shout. */}
						{/* Which speed the pump is held at, for a program that runs one.
						    Without it two programs on the same pump — one holding it at
						    Low, one simply switching it on — are the same row twice, and
						    the speed is the whole difference between them. */}
						{speed ? (
							<Chip color="accent" size="sm" variant="soft">
								<Gauge className="size-3" />
								{speed}
							</Chip>
						) : null}
						<Chip
							color={schedule.days === "AllDays" ? "default" : "accent"}
							size="sm"
							variant="soft"
						>
							{dayLabel(schedule.days)}
						</Chip>
						{/* The schedule that started all of this ran 4PM to 4AM, and read
						    as a plain pair of times it looks like an afternoon. Warning
						    rather than a neutral tone because a window crossing midnight
						    is the thing owners misread, not merely a detail. */}
						{overnight ? (
							<Chip color="warning" size="sm" variant="soft">
								Overnight
							</Chip>
						) : null}
					</div>
				</div>
			</div>

			<ScheduleEditor
				// Whatever this schedule already points at stays selectable, so opening
				// a program and saving it cannot silently move it to other equipment.
				// A speed program is the case that needs saying twice: its `deviceId`
				// is a speed and appears in no device list at all, so it is handed in
				// as an entry of its own, named the way the row above names it. The
				// editor fixes that field rather than offering the list — see
				// `speedProgram` there.
				devices={
					speed
						? [
								{
									id: schedule.deviceId,
									name: `${name} — ${speed}`,
									isVsp: false,
								},
							]
						: schedulable.some((d) => d.id === schedule.deviceId)
							? schedulable
							: devices.filter((d) => !d.isVsp || d.id === schedule.deviceId)
				}
				error={editError}
				isPending={isPending}
				onDelete={onDelete}
				onSave={onSave}
				schedule={schedule}
				title="Edit schedule"
				trigger={
					// Labelled rather than icon-only. The pencil alone had to carry the
					// whole meaning of the row's one action, and an icon-only control
					// wants a tooltip to say what it does — which a phone has no way to
					// show. The word says it outright and costs a few points of a row
					// that has them to spare.
					<Button
						aria-label={`Edit ${name} schedule`}
						size="sm"
						variant="tertiary"
					>
						<Pencil className="size-3.5" />
						Edit
					</Button>
				}
			/>
		</Card>
	);
}
