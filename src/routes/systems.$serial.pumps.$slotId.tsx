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
 * Sections appear as their data lands rather than behind one spinner. Identity
 * comes from the slot table, which is persisted and usually already in hand;
 * the speeds are a request of their own and the master speeds another. Holding
 * the whole page for the slowest of the three would blank a screen that mostly
 * knows its own answer.
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

	const slot = slots.data?.find((s) => s.slotId === slotId);
	if (slots.isPending) return <Loading />;

	// A slot number that names nothing, or names an empty slot. Both are reachable
	// by typing a URL, and neither has anything to configure.
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
