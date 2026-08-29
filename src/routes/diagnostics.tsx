import { Button, Card, ScrollShadow } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppHeader, IconBtn } from "#/components/app-header";
import {
	account,
	api,
	getDevices,
	getHome,
	getMasterDeviceList,
	getOnetouch,
	getVspAppModelSerials,
	getVspNames,
	getVspSpeeds,
	listSystems,
	sessionMeta,
} from "#/lib/aqualink/client";
import { AqualinkError } from "#/lib/aqualink/types";
import { useLogout } from "#/lib/queries";

/** Placeholder shown before any probe has run. */
const EMPTY = "—";

export const Route = createFileRoute("/diagnostics")({
	component: Diagnostics,
});

/** Every read command the p-api exposes, grouped by subsystem. */
const SCREEN_PROBES: [string, (serial: string) => Promise<unknown>][] = [
	["get_home", getHome],
	["get_devices", getDevices],
	["get_onetouch", getOnetouch],
];

const VSP_PROBES: [string, (serial: string) => Promise<unknown>][] = [
	["get_vsp_names", getVspNames],
	["get_vsp_speedauxinfo", (s) => getVspSpeeds(s)],
	["get_vsp_appmodelserials", getVspAppModelSerials],
	["get_master_device_list (0)", (s) => getMasterDeviceList(s, "0")],
	["get_master_device_list (1)", (s) => getMasterDeviceList(s, "1")],
	["get_master_device_list (2)", (s) => getMasterDeviceList(s, "2")],
];

/**
 * Ground-truth harvester. Click a row, get the raw JSON back from the real
 * API using the live browser session.
 */
function Diagnostics() {
	const [out, setOut] = useState(EMPTY);
	const [busy, setBusy] = useState("");
	const meta = sessionMeta();
	const logout = useLogout();
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

	/** Resolve the first system's serial, then run a command against it. */
	function onSerial(label: string, fn: (serial: string) => Promise<unknown>) {
		return () =>
			probe(label, async () => {
				const list = await listSystems();
				const first = list[0];
				if (!first?.serial) return "no systems on this account";
				return fn(String(first.serial));
			});
	}

	/** The VSP commands only answer on a system the account flags as VSP. */
	const vspFlag = () =>
		probe("isVSP", async () => {
			const list = await listSystems();
			return list.map((s) => ({
				serial: s.serial,
				name: s.name,
				isVSP: s.isVSP,
				type: s.type,
				status: s.status,
			}));
		});

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
			<AppHeader>
				<IconBtn label="Back to dashboard" to="/">
					<ArrowLeft className="size-4" />
				</IconBtn>
				<IconBtn label="Sign out" onPress={() => logout.mutate()}>
					<LogOut className="size-4" />
				</IconBtn>
			</AppHeader>

			<h2 className="mb-1 text-xl font-semibold tracking-tight">Diagnostics</h2>
			<p className="mb-6 text-xs text-muted">
				userId {meta.userId || "?"} · country {meta.country || "?"}
			</p>

			<Section title="Account (prm REST)">
				<Button size="sm" onPress={() => probe("account", account)}>
					account
				</Button>
				<Button size="sm" onPress={() => probe("locations", listSystems)}>
					locations
				</Button>
				<Button size="sm" onPress={() => probe("userId", () => api("/userId"))}>
					userId
				</Button>
				<Button size="sm" onPress={vspFlag}>
					isVSP flags
				</Button>
			</Section>

			<Section title="Screens (p-api session)">
				{SCREEN_PROBES.map(([label, fn]) => (
					<Button key={label} size="sm" onPress={onSerial(label, fn)}>
						{label}
					</Button>
				))}
			</Section>

			<Section title="Variable speed pumps">
				{VSP_PROBES.map(([label, fn]) => (
					<Button key={label} size="sm" onPress={onSerial(label, fn)}>
						{label}
					</Button>
				))}
			</Section>

			<Card>
				<Card.Header className="flex-row items-center justify-between gap-3">
					<Card.Title className="text-xs font-medium uppercase tracking-widest text-muted">
						{busy || "response"}
					</Card.Title>
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						aria-label="Copy response"
						isDisabled={out === EMPTY}
						onPress={copy}
					>
						{copied ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
					</Button>
				</Card.Header>
				{/* Wrapping keeps this to one scroll axis despite very long values. */}
				<ScrollShadow className="max-h-[60vh]">
					<pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
						{out}
					</pre>
				</ScrollShadow>
			</Card>
		</main>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="mb-6">
			<h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
				{title}
			</h3>
			<div className="flex flex-wrap gap-2">{children}</div>
		</div>
	);
}
