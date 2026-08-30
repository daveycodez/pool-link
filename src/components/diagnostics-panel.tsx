import { Button, Card, ScrollShadow, Spinner } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardColumns } from "#/components/card-columns";
import {
	account,
	api,
	getDeviceStatus,
	getDevices,
	getHome,
	getMasterDeviceList,
	getOnetouch,
	getPhOrpCalibrationStatus,
	getPhOrpLastCalibration,
	getPhOrpValues,
	getScheduleList,
	getSwcConfig,
	getUnassignedSerials,
	getVspAppModelSerials,
	getVspDefinition,
	getVspNames,
	getVspSpeeds,
	iclGetInfo,
	listSystems,
	sessionMeta,
} from "#/lib/aqualink/client";
import { AqualinkError } from "#/lib/aqualink/types";

/** Placeholder shown before any probe has run. */
const EMPTY = "—";

/** A labelled call against one system. */
type ProbeEntry = [string, (serial: string) => Promise<unknown>];

/**
 * Every read command the p-api exposes for one system, grouped by subsystem.
 *
 * Reads only, and the rule is not a style preference: a row here fires the
 * moment it is clicked, with no confirmation and against the owner's real pool.
 * A write in this list is a relay that closes because somebody was curious.
 */
const SCREEN_PROBES: ProbeEntry[] = [
	["device status", getDeviceStatus],
	["get_home", getHome],
	["get_devices", getDevices],
	["get_onetouch", getOnetouch],
	// Documented by iaqualink-py but never called by this app, and unproven
	// against a real panel — which is exactly what a probe is for. Schedules
	// are otherwise only reachable through WebTouch, so an answer here would
	// mean the panel's own programs are readable after all.
	["get_schedule_list", getScheduleList],
	// The zone list on its own, which carries the RGBW behind a custom colour
	// that the copy folded into get_devices leaves out. Upstream records this
	// command timing out on hardware and reads zones from get_devices instead,
	// so a hang here is the known answer and not a fault in this app.
	["get_icl_info", iclGetInfo],
	// Answers on a panel with a cell paired and rejects on one without, which
	// is the only way to tell those apart — get_home's swc_info says a cell is
	// absent either way.
	["get_swc_config", getSwcConfig],
];

/**
 * Every command that changes something, listed and not wired.
 *
 * A probe is a button, and a button that fires set_temps against a real pool
 * is a diagnostics page that reheats someone's spa because they were curious.
 * So the writes are here as a reference — what the panel accepts, next to the
 * reads that prove which subsystems answer — and nowhere near an onPress.
 *
 * Grouped as the constants are, since that grouping is the subsystem map.
 */
const WRITE_COMMANDS: [string, string[]][] = [
	["Screens", ["set_aux", "set_onetouch", "set_light"]],
	[
		"Temperature",
		[
			"set_temps",
			"set_pool_heater",
			"set_spa_heater",
			"set_solar_heater",
			"set_pool_pump",
			"set_spa_pump",
		],
	],
	["Heat pump", ["enable_disable_hpm", "switch_hpm_mode", "setpoint_hpm_temp"]],
	["Chlorinator", ["set_swc_config", "control_swc_boost"]],
	[
		"Colour lights",
		[
			"onoff_iclzone",
			"set_iclzone_color",
			"define_iclzone_customcolor",
			"set_iclzone_dim",
			"set_iclzone_name",
			"enable_disable_zoning_mode",
			"move_lights_to_zone",
		],
	],
	[
		"Variable speed pumps",
		[
			"enable_disable_pump_speedId",
			"set_aux_speed",
			"set_vsp_name",
			"set_vsp_definition",
			"assign_vsp_serial",
			"unassign_vsp_serial",
			"set_speed_name",
			"set_speedname_value",
			"enable_pump_speed_value",
		],
	],
	["Scheduling", ["do_schedule_operation"]],
	[
		"TruSense",
		["do1pointphcalibration", "do_2point_phcalibration", "do_orp_calibration"],
	],
];

/**
 * Sensor unit ids to try for the TruSense probe. The protocol reference
 * establishes that `unit_id` is an integer and admits it has never seen a live
 * value, so the range is genuinely unknown — probing the two lowest is cheaper
 * than picking one and reading its rejection as "no sensor fitted".
 */
const PHORP_UNITS = [0, 1];

const PHORP_COMMANDS: [
	string,
	(serial: string, unitId: number) => Promise<unknown>,
][] = [
	["get_phorp_values", getPhOrpValues],
	["get_phorp_lastcalibinfo", getPhOrpLastCalibration],
	["get_phorp_calibstatus", getPhOrpCalibrationStatus],
];

const PHORP_PROBES: ProbeEntry[] = PHORP_COMMANDS.flatMap(([label, fn]) =>
	PHORP_UNITS.map(
		(unit): ProbeEntry => [`${label} (unit ${unit})`, (s) => fn(s, unit)],
	),
);

/**
 * Slots are pump positions on the panel, not aux relays. An empty slot answers
 * with the factory-default speed table rather than an error, so the only way to
 * tell it apart from a real pump is appmodelserials — probe the range and
 * compare.
 */
const VSP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

const VSP_PROBES: ProbeEntry[] = [
	["get_vsp_names", getVspNames],
	["get_vsp_appmodelserials", getVspAppModelSerials],
	["get_unassigned_serials", getUnassignedSerials],
	...VSP_SLOTS.map(
		(slot): ProbeEntry => [
			`get_vsp_speedauxinfo (slot ${slot})`,
			(s) => getVspSpeeds(s, slot),
		],
	),
	// The definition says which unit a slot's min, max and presets are counted
	// in — a flow-rate pump and a speed pump report the same integers — and it
	// is the only read that distinguishes them. Probed per slot for the same
	// reason speedauxinfo is: a stub slot answers rather than refusing.
	...VSP_SLOTS.map(
		(slot): ProbeEntry => [
			`get_vsp_definition (slot ${slot})`,
			(s) => getVspDefinition(s, slot),
		],
	),
	["get_master_device_list (0)", (s) => getMasterDeviceList(s, "0")],
	["get_master_device_list (1)", (s) => getMasterDeviceList(s, "1")],
	["get_master_device_list (2)", (s) => getMasterDeviceList(s, "2")],
];

/**
 * Ground-truth harvester. Click a row, get the raw JSON back from the real API
 * using the live browser session. Account probes always show; the per-system
 * sections appear only when the URL names a system.
 */
export function DiagnosticsPanel({ serial }: { serial?: string }) {
	const [out, setOut] = useState(EMPTY);
	const [busy, setBusy] = useState("");
	const meta = sessionMeta();
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (copyTimer.current) clearTimeout(copyTimer.current);
		},
		[],
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(out);
			setCopied(true);
			if (copyTimer.current) clearTimeout(copyTimer.current);
			copyTimer.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard is unavailable outside a secure context; nothing to do.
		}
	}

	async function probe(label: string, run: () => Promise<unknown>) {
		setBusy(label);
		try {
			setOut(JSON.stringify(await run(), null, 2));
		} catch (e) {
			// p-api explains rejected commands in the response body — show it.
			setOut(
				e instanceof AqualinkError
					? JSON.stringify(
							{ error: e.message, status: e.status, body: e.body },
							null,
							2,
						)
					: `ERROR: ${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			setBusy("");
		}
	}

	function onSerial(label: string, fn: (s: string) => Promise<unknown>) {
		return () => probe(label, () => fn(serial as string));
	}

	return (
		<CardColumns>
			<Card>
				<Card.Header>
					<Card.Title>Session</Card.Title>
				</Card.Header>
				<Meta label="User" value={meta.userId} />
				<Meta label="Country" value={meta.country} />
				{serial ? <Meta label="Serial" value={serial} /> : null}
			</Card>

			<Card>
				<Card.Header>
					<Card.Title>Account</Card.Title>
					<Card.Description>Signed-in user and their systems.</Card.Description>
				</Card.Header>
				<Probes>
					{/* Labels are what the spinner keys on, so no two may share one —
					    the raw and parsed locations rows would otherwise both spin. */}
					<Probe
						isDisabled={Boolean(busy)}
						isPending={busy === "account"}
						onPress={() => probe("account", account)}
					>
						account
					</Probe>
					<Probe
						isDisabled={Boolean(busy)}
						isPending={busy === "locations (raw)"}
						onPress={() =>
							probe("locations (raw)", () =>
								api(`/users/${sessionMeta().userId}/locations`),
							)
						}
					>
						locations (raw)
					</Probe>
					<Probe
						isDisabled={Boolean(busy)}
						isPending={busy === "locations (parsed)"}
						onPress={() => probe("locations (parsed)", listSystems)}
					>
						locations (parsed)
					</Probe>
					<Probe
						isDisabled={Boolean(busy)}
						isPending={busy === "userId"}
						onPress={() => probe("userId", () => api("/userId"))}
					>
						userId
					</Probe>
				</Probes>
			</Card>

			{serial ? (
				<>
					<Card>
						<Card.Header>
							<Card.Title>Screens</Card.Title>
							<Card.Description>
								Panel state over the p-api session endpoint.
							</Card.Description>
						</Card.Header>
						<Probes>
							{SCREEN_PROBES.map(([label, fn]) => (
								<Probe
									isDisabled={Boolean(busy)}
									isPending={busy === label}
									key={label}
									onPress={onSerial(label, fn)}
								>
									{label}
								</Probe>
							))}
						</Probes>
					</Card>

					<Card>
						<Card.Header>
							<Card.Title>Variable Speed Pumps</Card.Title>
							<Card.Description>
								Speeds are addressed by id, with no aux relay involved.
							</Card.Description>
						</Card.Header>
						<Probes>
							{VSP_PROBES.map(([label, fn]) => (
								<Probe
									isDisabled={Boolean(busy)}
									isPending={busy === label}
									key={label}
									onPress={onSerial(label, fn)}
								>
									{label}
								</Probe>
							))}
						</Probes>
					</Card>

					<Card>
						<Card.Header>
							<Card.Title>TruSense</Card.Title>
							<Card.Description>
								What the pH/ORP probe says about itself, which the home screen's
								bare readings cannot.
							</Card.Description>
						</Card.Header>
						<Probes>
							{PHORP_PROBES.map(([label, fn]) => (
								<Probe
									isDisabled={Boolean(busy)}
									isPending={busy === label}
									key={label}
									onPress={onSerial(label, fn)}
								>
									{label}
								</Probe>
							))}
						</Probes>
					</Card>
				</>
			) : null}

			{serial ? (
				<Card>
					<Card.Header>
						<Card.Title>Write commands</Card.Title>
						<Card.Description>
							Every command that changes something, for reference. Deliberately
							not clickable — these act on the real pool.
						</Card.Description>
					</Card.Header>
					<div className="flex flex-col gap-3">
						{WRITE_COMMANDS.map(([group, cmds]) => (
							<div key={group}>
								<p className="text-xs font-medium uppercase tracking-widest text-muted">
									{group}
								</p>
								<p className="mt-1 font-mono text-[11px] leading-relaxed text-muted">
									{cmds.join(", ")}
								</p>
							</div>
						))}
					</div>
				</Card>
			) : null}

			<Card>
				<Card.Header className="flex-row items-center justify-between gap-4">
					<Card.Title>{busy || "Response"}</Card.Title>
					<Button
						aria-label={copied ? "Response copied" : "Copy response"}
						isDisabled={out === EMPTY}
						isIconOnly
						onPress={copy}
						size="sm"
						variant="ghost"
					>
						{copied ? <Check /> : <Copy />}
					</Button>
				</Card.Header>
				{/* Wrapping keeps this to one scroll axis despite very long values. */}
				{/* Whatever was here belonged to the last command, and the title above
				    already names the new one — leaving the old JSON under the new
				    heading reads as an answer that has arrived. The spinner says the
				    only true thing for those seconds. */}
				{busy ? (
					<div className="flex justify-center py-6">
						<Spinner size="sm" />
					</div>
				) : (
					<ScrollShadow className="max-h-[60vh]">
						<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
							{out}
						</pre>
					</ScrollShadow>
				)}
			</Card>
		</CardColumns>
	);
}

function Meta({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4 text-xs">
			<span className="text-muted">{label}</span>
			<span className="truncate font-mono">{value || "—"}</span>
		</div>
	);
}

/** Probes are secondary actions, so they never take the filled variant. */
function Probes({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Probe({
	onPress,
	isPending,
	isDisabled,
	children,
}: {
	onPress: () => void;
	/** This is the probe in flight, so it carries the spinner. */
	isPending?: boolean;
	/** Any probe is in flight: the panel answers one command at a time. */
	isDisabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Button
			isDisabled={isDisabled}
			onPress={onPress}
			size="sm"
			variant="secondary"
		>
			{isPending ? <Spinner color="current" size="sm" /> : null}
			{children}
		</Button>
	);
}
