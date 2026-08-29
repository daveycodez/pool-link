import {
	AlertDialog,
	Button,
	Card,
	Chip,
	Input,
	Label,
	TextField,
} from "@heroui/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, House, Plus } from "lucide-react";
import { useState } from "react";
import { IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import {
	errorMessage,
	type Raw,
	type SystemSummary,
} from "#/lib/aqualink/types";
import { useAddDevice, useDeviceStatus, useSystems } from "#/lib/queries";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/")({
	component: Systems,
});

function Systems() {
	const { pending, signedIn } = useRequireSession();
	const systems = useSystems(true);

	if (pending || systems.isPending) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	const list = systems.data ?? [];
	if (list.length === 0) {
		return (
			<Card className="text-sm text-muted">
				No systems on this iAqualink account.
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{list.map((system) => (
				<SystemCard key={system.serial} system={system} />
			))}
			<AddSystemCard />
		</div>
	);
}

/**
 * Serials print grouped on the hardware label but the API wants them bare, so
 * accept either and strip everything that is not alphanumeric.
 */
function normalizeSerial(input: string): string {
	return input.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function AddSystemCard() {
	const add = useAddDevice();
	const [serial, setSerial] = useState("");
	const [name, setName] = useState("");
	const cleaned = normalizeSerial(serial);

	return (
		<AlertDialog>
			<AlertDialog.Trigger className="card-link">
				<Card className="flex-row items-center justify-between gap-4">
					<div className="flex items-center gap-4">
						<IconCircle on={false}>
							<Plus className="size-4" />
						</IconCircle>
						<Card.Title>Add system</Card.Title>
					</div>
					<ChevronRight className="size-5 text-muted" />
				</Card>
			</AlertDialog.Trigger>
			<AlertDialog.Backdrop>
				<AlertDialog.Container>
					<AlertDialog.Dialog>
						<AlertDialog.Header>
							<AlertDialog.Heading>Add system</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<div className="flex flex-col gap-4">
								<TextField
									autoFocus
									fullWidth
									onChange={setSerial}
									value={serial}
									variant="secondary"
								>
									<Label>Serial number</Label>
									<Input placeholder="xxx-xxx-xxx-xxx" />
								</TextField>
								<TextField
									fullWidth
									onChange={setName}
									value={name}
									variant="secondary"
								>
									<Label>Name</Label>
									<Input placeholder="Backyard" />
								</TextField>
								{add.isError ? (
									<p className="text-xs text-danger" role="alert">
										{errorMessage(add.error)}
									</p>
								) : null}
							</div>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button slot="close" variant="tertiary">
								Cancel
							</Button>
							<Button
								isDisabled={!cleaned || !name.trim()}
								onPress={() =>
									add.mutate(
										{ serial: cleaned, name: name.trim() },
										{
											onSuccess: () => {
												setSerial("");
												setName("");
											},
										},
									)
								}
								slot="close"
							>
								Add
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}

function SystemCard({ system }: { system: SystemSummary }) {
	// The locations payload has no status, only a `statusLink` token, so online
	// state is a second request per card: {"status":{"Status":"Online",…}}.
	const status = useDeviceStatus(system.serial);
	const value = String((status.data?.status as Raw | undefined)?.Status ?? "");
	const online = value.toLowerCase() === "online";
	// Amber until the first response lands — an immediate red would read as a
	// real outage while the request is still in flight. Anything that comes
	// back other than Online is shown verbatim rather than flattened.
	const color = status.isPending ? "warning" : online ? "success" : "danger";
	const label = status.isPending ? "Loading" : value || "Unknown";

	return (
		<Link
			className="card-link"
			params={{ serial: system.serial }}
			to="/systems/$serial"
		>
			<Card className="flex-row items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-4">
					<IconCircle on={online}>
						<House className="size-4" />
					</IconCircle>
					<Card.Title className="truncate">{system.name}</Card.Title>
				</div>
				<div className="flex shrink-0 items-center gap-4">
					{/* Same swatch as the light colour picker. Colour alone carries the
					    meaning, so pair it with text for screen readers. */}
					<Chip color={color} size="sm" variant="soft">
						{label}
					</Chip>
					<ChevronRight className="size-5 text-muted" />
				</div>
			</Card>
		</Link>
	);
}
