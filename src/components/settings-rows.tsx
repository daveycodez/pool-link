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
	Hash,
	LogOut,
	MapPinHouse,
	Monitor,
	Moon,
	Pencil,
	Stethoscope,
	Sun,
	SunMoon,
	Tag,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { AddSystemRow } from "#/components/add-system";
import { IconCircle } from "#/components/device-row";
import { errorMessage } from "#/lib/aqualink/types";
import { groupSerial } from "#/lib/format";
import { useSetDeviceName, useSystems } from "#/lib/queries";

const THEMES = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "light", label: "Light", Icon: Sun },
	{ id: "dark", label: "Dark", Icon: Moon },
] as const;

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
 * Account-level rows, shared by both settings pages. `serial` scopes the
 * Diagnostics link to the current system and adds a way back to the list.
 */
export function AccountSettingsRows({ serial }: { serial?: string }) {
	const { theme, setTheme } = useTheme();
	// Already cached by the layout, so this costs no request of its own.
	const systems = useSystems(true).data ?? [];

	// next-themes only knows the resolved theme after mount, so render the
	// control's value once we're on the client to avoid a hydration mismatch.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		<>
			{/* The row names the setting, so it keeps one icon; the options
			    carry their own to show what each choice is. `Select.Value`
			    renders the selected item's children rather than its text, so
			    the trigger picks up that icon without being told — it only
			    needs to lay out as a row, which `.select__value` does not. */}
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

			{serial ? (
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
			)}

			{/* Inside a system the bottom nav only covers Pool/Equipment, so this
			    is the way back out to the account's other systems — but with only
			    one system there is nothing to go back to, and the header's own
			    mark already leads there. */}
			{serial && systems.length > 1 ? (
				<Link className="card-link" to="/">
					<SettingsRow Icon={MapPinHouse} title="My Systems">
						<ChevronRight className="size-5 text-muted" />
					</SettingsRow>
				</Link>
			) : null}

			{/* Account-level, so it sits on both settings pages — a system is
			    added to the account, not to whichever one is in scope. */}
			<AddSystemRow />

			<Link className="card-link" to="/sign-out">
				<SettingsRow Icon={CircleUser} title="Sign out">
					<LogOut className="size-4 text-muted" />
				</SettingsRow>
			</Link>
		</>
	);
}
