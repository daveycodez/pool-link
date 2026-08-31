import { Button, Card, Disclosure } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Gauge } from "lucide-react";
import { useState } from "react";
import { IconCircle } from "#/components/device-row";
import type { VspSlot } from "#/lib/aqualink/client";
import { useVspSlots } from "#/lib/queries";
import { CardColumns } from "./card-columns";
import { Loading } from "./loading";

/**
 * The last slot addressed by switches on the pump itself.
 *
 * Jandy's older JEP/AUT/SVRS pumps carry no serial the panel can ask for, so a
 * slot is claimed by setting a two-bit DIP field on the pump — four addresses,
 * which is exactly the span of pump addresses on the RS-485 bus (0x78 to 0x7B)
 * and exactly the four slots the vendor's own app labels "DIP Switch Address".
 * Newer DV2A pumps answer with a serial instead and occupy the remaining
 * sixteen slots, where the vendor states plainly that DIP addresses are no
 * longer used. The boundary is not cosmetic: it decides whether a slot's
 * address is a number an installer set with a screwdriver or a serial the pump
 * reported for itself, and printing the wrong one tells somebody standing at
 * their equipment pad to go looking for a switch that does not exist.
 */
const DIP_ADDRESS_MAX = 4;

/** How a slot says which pump it is, which is not the same answer for all twenty. */
export function pumpAddress(slot: VspSlot): { label: string; value: string } {
	if (slot.slotId <= DIP_ADDRESS_MAX)
		return { label: "DIP Switch Address", value: String(slot.slotId) };
	return {
		label: "Pump Address",
		value: slot.pumpSerial || "Not Assigned",
	};
}

/** Entry point from system settings. */
export function PumpSetupRow({ serial }: { serial: string }) {
	return (
		<Link className="card-link" params={{ serial }} to="/systems/$serial/pumps">
			<Card className="flex-row items-center justify-between gap-4">
				<div className="flex items-center gap-4">
					<IconCircle on={false}>
						<Gauge className="size-4" />
					</IconCircle>
					<Card.Title>Pump Setup</Card.Title>
				</div>
				<ChevronRight className="size-5 text-muted" />
			</Card>
		</Link>
	);
}

function SlotCard({ slot, serial }: { slot: VspSlot; serial: string }) {
	// No address here: a serial is thirteen characters of noise in a list, and
	// the slot number is already in an unconfigured slot's name. The pump's own
	// page says which it is, which is where somebody asking has gone anyway.
	const body = (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex min-w-0 items-center gap-4">
				<IconCircle on={false}>
					<Gauge className="size-4" />
				</IconCircle>
				<div className="min-w-0">
					<Card.Title className="truncate">{slot.name}</Card.Title>
					<Card.Description className="truncate">
						{slot.appName}
					</Card.Description>
				</div>
			</div>
			{slot.installed ? (
				<ChevronRight className="size-5 shrink-0 text-muted" />
			) : null}
		</Card>
	);

	// An empty slot is a row, not a destination. There is nothing behind it to
	// configure — no pump answers for it — so it gets no link and no hover.
	if (!slot.installed) return body;

	return (
		<Link
			className="card-link"
			params={{ serial, slotId: String(slot.slotId) }}
			to="/systems/$serial/pumps/$slotId"
		>
			{body}
		</Link>
	);
}

/**
 * Every pump slot the panel has.
 *
 * Installed pumps first and unconditionally; the seventeen-odd empty slots sit
 * behind a disclosure, because a page that opens on sixteen rows reading "Not
 * Installed" has buried the one row somebody came here for. They are still
 * rendered, and still say what they are — an installer commissioning a pump
 * needs to see the slot before it holds anything.
 *
 * The disclosure opens by default only when nothing is installed, which is the
 * one case where the empty slots *are* the content and a collapsed page would
 * look broken.
 */
export function PumpSlotList({ serial }: { serial: string }) {
	const { data: slots, isPending } = useVspSlots(serial);
	const installed = (slots ?? []).filter((s) => s.installed);
	const empty = (slots ?? []).filter((s) => !s.installed);
	const [showEmpty, setShowEmpty] = useState(false);

	if (isPending || !slots) return <Loading />;

	const noneInstalled = installed.length === 0;

	return (
		<div className="space-y-8">
			{noneInstalled ? (
				<Card>
					<Card.Title>No pumps installed</Card.Title>
					<Card.Description>
						This panel has twenty pump slots and nothing assigned to any of
						them. A variable-speed pump has to be commissioned at the panel
						before it can be set up here.
					</Card.Description>
				</Card>
			) : (
				<CardColumns>
					{installed.map((slot) => (
						<SlotCard key={slot.slotId} serial={serial} slot={slot} />
					))}
				</CardColumns>
			)}

			{empty.length > 0 ? (
				<Disclosure
					isExpanded={showEmpty || noneInstalled}
					onExpandedChange={setShowEmpty}
				>
					<Disclosure.Heading>
						<Button slot="trigger" variant="tertiary">
							{`${empty.length} empty ${empty.length === 1 ? "slot" : "slots"}`}
							<Disclosure.Indicator />
						</Button>
					</Disclosure.Heading>
					<Disclosure.Content>
						<Disclosure.Body className="space-y-8 pt-4">
							<EmptyGroup
								description="Legacy Jandy JEP, AUT and SVRS pumps have no serial the panel can read, so these four slots are claimed by the DIP switches on the pump itself."
								serial={serial}
								slots={empty.filter((s) => s.slotId <= DIP_ADDRESS_MAX)}
								title="DIP Switch Address"
							/>
							<EmptyGroup
								description="Newer Jandy DV2A pumps report their own serial, and are assigned to a slot at the panel rather than by a switch."
								serial={serial}
								slots={empty.filter((s) => s.slotId > DIP_ADDRESS_MAX)}
								title="Serial Address"
							/>
						</Disclosure.Body>
					</Disclosure.Content>
				</Disclosure>
			) : null}
		</div>
	);
}

function EmptyGroup({
	title,
	description,
	slots,
	serial,
}: {
	title: string;
	description: string;
	slots: VspSlot[];
	serial: string;
}) {
	if (!slots.length) return null;
	return (
		<div className="space-y-4">
			<div className="space-y-1 px-1">
				<h2 className="text-sm font-medium text-muted">{title}</h2>
				<p className="text-xs text-muted">{description}</p>
			</div>
			<CardColumns>
				{slots.map((slot) => (
					<SlotCard key={slot.slotId} serial={serial} slot={slot} />
				))}
			</CardColumns>
		</div>
	);
}
