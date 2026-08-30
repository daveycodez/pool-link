import {
	AlertDialog,
	Button,
	Card,
	Input,
	Label,
	TextField,
} from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { IconCircle } from "#/components/device-row";
import { errorMessage } from "#/lib/aqualink/types";
import { useAddDevice } from "#/lib/queries";

/**
 * Serials print grouped on the hardware label but the API wants them bare, so
 * accept either and strip everything that is not alphanumeric.
 */
function normalizeSerial(input: string): string {
	return input.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/**
 * Attaching a system to the account. Shaped like a settings row because that
 * is where it mostly lives — it belongs to the account rather than to any one
 * system, so both settings pages carry it, as does the list it adds to.
 */
export function AddSystemRow() {
	const add = useAddDevice();
	const navigate = useNavigate();
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
								onPress={async () => {
									try {
										await add.mutateAsync({
											name: name.trim(),
											serial: cleaned,
										});
										setSerial("");
										setName("");
										// The list is where the new system appears, and the
										// refetch above has already landed by here.
										navigate({ to: "/" });
									} catch {
										// Reported by the global mutation handler; the dialog
										// keeps what was typed so it can be corrected.
									}
								}}
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
