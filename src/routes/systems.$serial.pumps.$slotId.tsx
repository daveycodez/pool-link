import { Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Loading } from "#/components/loading";
import { PumpFeatureSpeeds, speedStep } from "#/components/pump-feature-speeds";
import { PumpIdentity } from "#/components/pump-identity";
import { PumpMasterSpeeds } from "#/components/pump-master-speeds";
import {
	usePanel,
	useVspDefinitions,
	useVspSlotSpeeds,
	useVspSlots,
} from "#/lib/queries";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/pumps/$slotId")({
	component: PumpDetail,
});

/**
 * One pump's setup: what it is, what its eight speeds are worth, and the
 * speeds the panel runs without being asked.
 *
 * The page waits for all three of its reads before drawing any of them. Two
 * come back from storage and one from the panel, so letting each section paint
 * as it arrived put Master Speeds directly under the pump's name and then shoved
 * it down the moment Feature Speeds landed above it. Nothing here is urgent
 * enough to be worth reading while it moves.
 *
 * Only the speed table is ever actually awaited after the first visit: the slot
 * and its definition are persisted, so the spinner is the cost of opening a
 * given pump once.
 */
function PumpDetail() {
	const { serial, slotId: raw } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const slotId = Number(raw);

	const slots = useVspSlots(serial);
	const defs = useVspDefinitions(serial);
	const speeds = useVspSlotSpeeds(serial, slotId);
	const panel = usePanel(serial);

	if (pending) return <Loading />;
	if (!signedIn) return null;

	if (slots.isPending) return <Loading />;
	const slot = slots.data?.find((s) => s.slotId === slotId);

	// A slot number that names nothing, or names an empty slot. Both are reachable
	// by typing a URL, and neither has anything to configure. This is settled
	// before the two reads below are waited on, and has to be: a pad with no
	// pumps at all skips the definitions entirely, so a page that waited on them
	// first would spin here forever.
	if (!slot?.installed) {
		return (
			<Card>
				<Card.Title>No pump here</Card.Title>
				<Card.Description>
					{slot
						? `Slot ${slotId} has no pump assigned to it.`
						: `This panel has no pump slot ${raw}.`}
				</Card.Description>
			</Card>
		);
	}

	// Past this point the slot is real and installed, so neither read is skipped
	// and neither can be pending forever. An error leaves its own section out
	// rather than the page — which is stable, since nothing arrives late.
	if (defs.isPending || speeds.isPending) return <Loading />;

	const definition = defs.data?.find((d) => d.slotId === slotId);
	const unit = (definition?.unit || "rpm").toUpperCase();
	const step = speedStep(unit);

	return (
		<div className="space-y-6">
			<PumpIdentity definition={definition} serial={serial} slot={slot} />

			{speeds.data ? (
				<PumpFeatureSpeeds
					devices={panel.data?.devices ?? []}
					serial={serial}
					setup={speeds.data}
					slotId={slotId}
					unit={unit}
				/>
			) : null}

			{definition ? (
				<PumpMasterSpeeds
					definition={definition}
					serial={serial}
					step={step}
					unit={unit}
				/>
			) : null}
		</div>
	);
}
