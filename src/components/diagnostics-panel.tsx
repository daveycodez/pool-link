import { Button, Card, ScrollShadow } from "@heroui/react";
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
					<Probe onPress={() => probe("account", account)}>account</Probe>
					<Probe
						onPress={() =>
							probe("locations", () =>
								api(`/users/${sessionMeta().userId}/locations`),
							)
						}
					>
						locations (raw)
					</Probe>
					<Probe onPress={() => probe("locations", listSystems)}>
						locations (parsed)
					</Probe>
					<Probe onPress={() => probe("userId", () => api("/userId"))}>
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
								<Probe key={label} onPress={onSerial(label, fn)}>
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
								<Probe key={label} onPress={onSerial(label, fn)}>
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
								<Probe key={label} onPress={onSerial(label, fn)}>
									{label}
								</Probe>
							))}
						</Probes>
					</Card>
				</>
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
				<ScrollShadow className="max-h-[60vh]">
					<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
						{out}
					</pre>
				</ScrollShadow>
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
	children,
}: {
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button onPress={onPress} size="sm" variant="secondary">
			{children}
		</Button>
	);
}
