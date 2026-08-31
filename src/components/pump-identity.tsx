import { AlertDialog, Button, InputGroup, TextField } from "@heroui/react";
import { Cpu, Hash, Pencil, Tag, Waves } from "lucide-react";
import { useState } from "react";
import { SettingsRow } from "#/components/settings-rows";
import type { VspDefinition, VspSlot } from "#/lib/aqualink/client";
import { errorMessage } from "#/lib/aqualink/types";
import { useSetPumpName } from "#/lib/queries";
import { pumpAddress } from "./pump-setup-rows";

/**
 * What the slot is, and what it is called.
 *
 * Only the name is editable. A pump's application and model are what the panel
 * believes is wired to the slot, and changing either does not make a pump
 * behave differently — it changes what the panel thinks it is talking to, and
 * keeps thinking it afterwards. That is a commissioning decision made at the
 * pad with the equipment in front of you, so the rows report it and stop there.
 */
export function PumpIdentity({
	serial,
	slot,
	definition,
}: {
	serial: string;
	slot: VspSlot;
	definition: VspDefinition | undefined;
}) {
	const rename = useSetPumpName(serial);
	const [name, setName] = useState<string | null>(null);
	const address = pumpAddress(slot);

	return (
		<div className="space-y-4">
			<SettingsRow Icon={Tag} title="Name">
				<TextField
					aria-label="Pump name"
					isReadOnly
					value={slot.name}
					variant="secondary"
				>
					<InputGroup>
						<InputGroup.Input className="w-39 pe-0 md:w-35" />
						<InputGroup.Suffix className="pe-0">
							<AlertDialog>
								<Button
									aria-label="Rename pump"
									isIconOnly
									onPress={() => setName(slot.name)}
									size="sm"
									variant="ghost"
								>
									<Pencil />
								</Button>
								<AlertDialog.Backdrop>
									<AlertDialog.Container>
										<AlertDialog.Dialog>
											<AlertDialog.Header>
												<AlertDialog.Heading>Rename pump</AlertDialog.Heading>
											</AlertDialog.Header>
											<AlertDialog.Body>
												<TextField
													aria-label="Pump name"
													autoFocus
													fullWidth
													onChange={setName}
													value={name ?? slot.name}
													variant="secondary"
												>
													<InputGroup>
														<InputGroup.Input placeholder="Filter Pump" />
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
													isDisabled={!name || name === slot.name}
													onPress={() =>
														name && rename.mutate({ slotId: slot.slotId, name })
													}
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

			<SettingsRow Icon={Waves} title="Application">
				<span className="shrink-0 text-sm text-muted">{slot.appName}</span>
			</SettingsRow>

			<SettingsRow Icon={Cpu} title="Model">
				<span className="shrink-0 text-sm text-muted">
					{definition?.model || slot.model}
				</span>
			</SettingsRow>

			<SettingsRow Icon={Hash} title={address.label}>
				<span className="shrink-0 text-sm text-muted tabular-nums">
					{address.value}
				</span>
			</SettingsRow>

			<p className="px-1 text-xs text-muted">
				Application and model are set when the pump is commissioned at the
				panel. They describe the hardware rather than how it runs, so this app
				reports them without changing them.
			</p>
		</div>
	);
}
