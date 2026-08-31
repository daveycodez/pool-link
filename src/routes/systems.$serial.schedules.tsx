import { Button, Card, Chip } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Zap } from "lucide-react";
import { CardColumns } from "#/components/card-columns";
import { IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { presetIcon } from "#/components/preset-icons";
import { ScheduleEditor } from "#/components/schedule-editor";
import type {
	Schedule,
	ScheduleDevice,
	ScheduleSpec,
} from "#/lib/aqualink/client";
import {
	useAddSchedule,
	useDeleteSchedule,
	useEditSchedule,
	useScheduleDevices,
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

function Schedules() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const schedules = useSchedules(serial);
	const devices = useScheduleDevices(serial);
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
	const rows = [...(list?.schedules ?? [])].sort(byAge);

	/**
	 * What a new schedule may be pointed at.
	 *
	 * The pump slots are held back deliberately. `listType=1` lists them
	 * alongside the relays — the same equipment appears twice, once as a plain
	 * device and once with `isVSP` set — but every schedule this panel has ever
	 * shown names the plain one, and nothing has established whether a pump
	 * schedule is written as that second id or as the first with a speed beside
	 * it. Offering the choice would be offering to find out on somebody's pump.
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

	if (rows.length === 0)
		return (
			<div className="space-y-4">
				<Card className="text-sm text-muted">
					This panel is running no schedules.
				</Card>
				<div className="flex justify-end">{addButton}</div>
			</div>
		);

	return (
		<div className="space-y-4">
			<CardColumns>
				{rows.map((schedule) => (
					<ScheduleRow
						devices={known}
						schedulable={schedulable}
						editError={edit.error}
						isPending={edit.isPending || remove.isPending}
						key={schedule.id}
						onDelete={() => remove.mutate(schedule.id)}
						onSave={(spec) => edit.mutate({ id: schedule.id, spec })}
						schedule={schedule}
					/>
				))}
			</CardColumns>

			<div className="flex justify-end">{addButton}</div>

			{/* The panel counts its own programs, and this walks its pages to
			    collect them. A shortfall means the walk stopped early, which is
			    worth saying plainly — the alternative is a page quietly claiming
			    to be the whole truth about when equipment runs. */}
			{list && list.total > rows.length ? (
				<p className="text-xs text-muted">
					Showing {rows.length} of {list.total} schedules this panel reports.
				</p>
			) : null}
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
}) {
	const name = deviceName(schedule.deviceId, devices);
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
				// Whatever this schedule already points at stays selectable even when
				// it is a pump slot the Add picker withholds, so opening a program and
				// saving it cannot silently move it to another piece of equipment.
				devices={
					schedulable.some((d) => d.id === schedule.deviceId)
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
