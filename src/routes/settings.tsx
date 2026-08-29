import {
	AlertDialog,
	Button,
	Card,
	InputGroup,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	LogOut,
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
import { Loading } from "#/components/loading";
import { errorMessage } from "#/lib/aqualink/types";
import { useLogout, useSetDeviceName, useSystems } from "#/lib/queries";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/settings")({
	component: Settings,
});

const THEMES = [
	{ id: "system", label: "System", Icon: Monitor },
	{ id: "light", label: "Light", Icon: Sun },
	{ id: "dark", label: "Dark", Icon: Moon },
] as const;

function Settings() {
	const { pending, signedIn } = useRequireSession();
	const navigate = useNavigate();
	const logout = useLogout();
	const { theme, setTheme } = useTheme();
	const systems = useSystems(true);
	const system = systems.data?.[0];
	const rename = useSetDeviceName(system?.serial);
	const [name, setName] = useState<string | null>(null);

	// next-themes only knows the resolved theme after mount, so render the
	// control's value once we're on the client to avoid a hydration mismatch.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	if (pending) return <Loading />;
	if (!signedIn) return null;

	const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

	return (
		<div className="space-y-4">
			<SettingsRow Icon={Tag} title="System name">
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

			<SettingsRow Icon={active.Icon} title="Appearance">
				<Select
					aria-label="Appearance"
					className="w-32"
					value={mounted ? (theme ?? "system") : "system"}
					variant="secondary"
					onChange={(v) => setTheme(String(v))}
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

			<SettingsRow Icon={Stethoscope} title="Diagnostics">
				<Button
					size="sm"
					variant="secondary"
					onPress={() => navigate({ to: "/diagnostics" })}
				>
					Open
				</Button>
			</SettingsRow>

			<SettingsRow Icon={LogOut} title="Sign out">
				<Button size="sm" variant="danger-soft" onPress={() => logout.mutate()}>
					Sign out
				</Button>
			</SettingsRow>
		</div>
	);
}

function SettingsRow({
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
