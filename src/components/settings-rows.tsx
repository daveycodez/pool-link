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
	ChevronRight,
	CircleUser,
	LogOut,
	MapPinHouse,
	Monitor,
	Moon,
	Pencil,
	Stethoscope,
	Sun,
	Tag,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { IconCircle } from "#/components/device-row";
import { errorMessage } from "#/lib/aqualink/types";
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
					<InputGroup.Input className="w-28" />
					<InputGroup.Suffix className="pe-0">
						<AlertDialog>
							<Button
								aria-label="Rename system"
								isIconOnly
								onPress={() => setName(system?.name ?? "")}
								size="sm"
								variant="ghost"
							>
								<Pencil className="size-4" />
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

/**
 * Account-level rows, shared by both settings pages. `serial` scopes the
 * Diagnostics link to the current system and adds a way back to the list.
 */
export function AccountSettingsRows({ serial }: { serial?: string }) {
	const { theme, setTheme } = useTheme();

	// next-themes only knows the resolved theme after mount, so render the
	// control's value once we're on the client to avoid a hydration mismatch.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

	return (
		<>
			<SettingsRow Icon={active.Icon} title="Appearance">
				<Select
					aria-label="Appearance"
					className="w-32"
					onChange={(v) => setTheme(String(v))}
					value={mounted ? (theme ?? "system") : "system"}
					variant="secondary"
				>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{THEMES.map((t) => (
								<ListBox.Item id={t.id} key={t.id} textValue={t.label}>
									{t.label}
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

			{/* Inside a system the bottom nav only covers Pool/Equipment, so this is
			    the way back out to the account's other systems. */}
			{serial ? (
				<Link className="card-link" to="/">
					<SettingsRow Icon={MapPinHouse} title="My Systems">
						<ChevronRight className="size-5 text-muted" />
					</SettingsRow>
				</Link>
			) : null}

			<Link className="card-link" to="/sign-out">
				<SettingsRow Icon={CircleUser} title="Sign out">
					<LogOut className="size-4 text-muted" />
				</SettingsRow>
			</Link>
		</>
	);
}
