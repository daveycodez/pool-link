import {
	AlertDialog,
	Button,
	Card,
	InputGroup,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { Link } from "@tanstack/react-router";
import {
	Check,
	ChevronRight,
	CircleUser,
	Copy,
	Cpu,
	Download,
	ExternalLink,
	Globe,
	Hash,
	LogOut,
	MapPinHouse,
	Pencil,
	Stethoscope,
	SunMoon,
	Tag,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { IconCircle } from "#/components/device-row";
import { THEMES } from "#/components/theme-toggle";
import { webtouchUrl } from "#/lib/aqualink/client";
import { errorMessage } from "#/lib/aqualink/types";
import { groupSerial } from "#/lib/format";
import { usePanel, useSetDeviceName, useSystems } from "#/lib/queries";
import { useInstall } from "#/lib/use-install";

export function SettingsRow({
	Icon,
	title,
	children,
}: {
	Icon: React.ComponentType<{ className?: string }>;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={false}>
					<Icon className="size-4" />
				</IconCircle>
				<Card.Title>{title}</Card.Title>
			</div>
			{children}
		</Card>
	);
}

/** Renames one system. Only meaningful where the URL names which one. */
export function SystemNameRow({ serial }: { serial: string }) {
	const systems = useSystems(true);
	const system = systems.data?.find((s) => s.serial === serial);
	const rename = useSetDeviceName(serial);
	const [name, setName] = useState<string | null>(null);

	return (
		<SettingsRow Icon={Tag} title="Name">
			<TextField
				aria-label="System name"
				isReadOnly
				value={system?.name ?? ""}
				variant="secondary"
			>
				<InputGroup>
					<InputGroup.Input className="w-39 pe-0 md:w-35" />
					<InputGroup.Suffix className="pe-0">
						<AlertDialog>
							<Button
								aria-label="Rename system"
								isIconOnly
								onPress={() => setName(system?.name ?? "")}
								size="sm"
								variant="ghost"
							>
								<Pencil />
							</Button>
							<AlertDialog.Backdrop>
								<AlertDialog.Container>
									<AlertDialog.Dialog>
										<AlertDialog.Header>
											<AlertDialog.Heading>Rename system</AlertDialog.Heading>
										</AlertDialog.Header>
										<AlertDialog.Body>
											<TextField
												aria-label="System name"
												autoFocus
												fullWidth
												onChange={setName}
												value={name ?? system?.name ?? ""}
												variant="secondary"
											>
												<InputGroup>
													<InputGroup.Input placeholder="Pool" />
												</InputGroup>
											</TextField>
											{rename.isError ? (
												<p className="mt-4 text-xs text-danger" role="alert">
													{errorMessage(rename.error)}
												</p>
											) : null}
										</AlertDialog.Body>
										<AlertDialog.Footer>
											<Button slot="close" variant="tertiary">
												Cancel
											</Button>
											<Button
												isDisabled={!name || name === system?.name}
												onPress={() => name && rename.mutate(name)}
												slot="close"
											>
												Save
											</Button>
										</AlertDialog.Footer>
									</AlertDialog.Dialog>
								</AlertDialog.Container>
							</AlertDialog.Backdrop>
						</AlertDialog>
					</InputGroup.Suffix>
				</InputGroup>
			</TextField>
		</SettingsRow>
	);
}

/** The serial is what the URL and every prm call address, so make it copyable. */
export function SystemSerialRow({ serial }: { serial: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	// Copy what is on screen — the add-system form strips the grouping back out.
	const grouped = groupSerial(serial);

	async function copy() {
		try {
			await navigator.clipboard.writeText(grouped);
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard is unavailable outside a secure context; nothing to do.
		}
	}

	return (
		<SettingsRow Icon={Hash} title="Serial">
			<TextField
				aria-label="Serial number"
				isReadOnly
				value={grouped}
				variant="secondary"
			>
				<InputGroup>
					<InputGroup.Input className="w-39 pe-0 font-mono md:w-35" />
					<InputGroup.Suffix className="pe-0">
						{/* No tooltip: Tooltip.Trigger renders its own focusable
						    div, which put a second tab stop around the button —
						    and the tick already says it copied. */}
						<Button
							aria-label={
								copied ? "Serial number copied" : "Copy serial number"
							}
							isIconOnly
							onPress={copy}
							size="sm"
							variant="ghost"
						>
							{copied ? <Check /> : <Copy />}
						</Button>
					</InputGroup.Suffix>
				</InputGroup>
			</TextField>
		</SettingsRow>
	);
}

/**
 * What the panel calls itself, which is the other half of the identity the
 * serial row above already gives: the serial names this installation, and this
 * names the hardware doing the work. Nothing else in the app says which panel
 * an account is talking to, and it is the first thing anyone comparing this
 * app's behaviour against someone else's has to know.
 *
 * Absent unless the panel volunteers it. Only one panel's frame has ever been
 * read, so the field is expected to be null on hardware this has never seen,
 * and a row that cannot say anything is worse than no row.
 */
export function PanelModelRow({ serial }: { serial: string }) {
	// Already cached by the layout, which polls this system on every page under
	// it, so this costs no request of its own.
	const model = usePanel(serial).data?.model;
	if (!model) return null;

	return (
		<SettingsRow Icon={Cpu} title="Panel">
			<span className="truncate font-mono text-muted text-sm">{model}</span>
		</SettingsRow>
	);
}

/** Appearance, as a row. The header carries the same control as a menu. */
export function AppearanceRow() {
	const { theme, setTheme } = useTheme();

	// next-themes only knows the resolved theme after mount, so render the
	// control's value once we're on the client to avoid a hydration mismatch.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		/* The row names the setting, so it keeps one icon; the options carry
		   their own to show what each choice is. `Select.Value` renders the
		   selected item's children rather than its text, so the trigger picks up
		   that icon without being told — it only needs to lay out as a row,
		   which `.select__value` does not. */
		<SettingsRow Icon={SunMoon} title="Appearance">
			<Select
				aria-label="Appearance"
				className="w-32"
				onChange={(v) => setTheme(String(v))}
				value={mounted ? (theme ?? "system") : "system"}
				variant="secondary"
			>
				<Select.Trigger>
					<Select.Value className="flex items-center gap-2" />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						{THEMES.map(({ id, label, Icon }) => (
							<ListBox.Item id={id} key={id} textValue={label}>
								<Icon className="size-4 shrink-0" />
								{label}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
		</SettingsRow>
	);
}

/**
 * The way back to an install the banner offered once and was waved away —
 * which is what lets that banner ask a single time and then stay quiet.
 * Absent where there is nothing to offer: already installed, or a browser that
 * does not install web apps at all.
 */
export function InstallRow() {
	const { canPrompt, manual, install } = useInstall();
	if (!canPrompt && !manual) return null;

	return (
		<SettingsRow Icon={Download} title="Install Web App">
			{canPrompt ? (
				<Button onPress={install} size="sm" variant="secondary">
					Install
				</Button>
			) : (
				// iOS has no gesture to offer, only a menu to point at.
				<span className="text-end text-muted text-xs">
					Share → Add to Home Screen
				</span>
			)}
		</SettingsRow>
	);
}

/** Scoped to the system in the URL when there is one. */
export function DiagnosticsRow({ serial }: { serial?: string }) {
	return serial ? (
		<Link
			className="card-link"
			params={{ serial }}
			to="/systems/$serial/diagnostics"
		>
			<SettingsRow Icon={Stethoscope} title="Diagnostics">
				<ChevronRight className="size-5 text-muted" />
			</SettingsRow>
		</Link>
	) : (
		<Link className="card-link" to="/diagnostics">
			<SettingsRow Icon={Stethoscope} title="Diagnostics">
				<ChevronRight className="size-5 text-muted" />
			</SettingsRow>
		</Link>
	);
}

/**
 * Opens the WebTouch remote — the panel's own web UI, which the official app
 * embeds for what no API covers, schedules first among them — signed in with
 * this app's session.
 */
export function WebTouchRow({ serial }: { serial: string }) {
	// Already cached by the layout, so this costs no request of its own.
	const system = useSystems(true).data?.find((s) => s.serial === serial);
	if (!system) return null;

	return (
		<button
			className="card-link w-full text-start"
			// The tab opens before the await: a fresh token can mean a network
			// round trip, and a window.open on the far side of one is a popup
			// where browsers count it, not a click.
			onClick={() => {
				const tab = window.open("about:blank", "_blank");
				webtouchUrl(system.webtouchId).then(
					(url) => {
						if (tab) tab.location.href = url;
					},
					() => tab?.close(),
				);
			}}
			type="button"
		>
			<SettingsRow Icon={Globe} title="WebTouch">
				<ExternalLink className="size-5 text-muted" />
			</SettingsRow>
		</button>
	);
}

/**
 * Inside a system the bottom nav only covers Pool/Equipment, so this is the way
 * back out to the account's other systems — but with only one system there is
 * nothing to go back to, and the header's own mark already leads there.
 */
export function MySystemsRow({ serial }: { serial?: string }) {
	// Already cached by the layout, so this costs no request of its own.
	const systems = useSystems(true).data ?? [];
	if (!serial || systems.length < 2) return null;

	return (
		<Link className="card-link" to="/">
			<SettingsRow Icon={MapPinHouse} title="My Systems">
				<ChevronRight className="size-5 text-muted" />
			</SettingsRow>
		</Link>
	);
}

export function SignOutRow() {
	return (
		<Link className="card-link" to="/sign-out">
			<SettingsRow Icon={CircleUser} title="Sign out">
				<LogOut className="size-4 text-muted" />
			</SettingsRow>
		</Link>
	);
}
