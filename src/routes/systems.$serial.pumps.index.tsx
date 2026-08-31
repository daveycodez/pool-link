import { createFileRoute } from "@tanstack/react-router";
import { Loading } from "#/components/loading";
import { PumpSlotList } from "#/components/pump-setup-rows";
import { useRequireSystem } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/pumps/")({
	component: PumpSetup,
});

/** Every pump slot the panel has, installed or not. */
function PumpSetup() {
	const { serial } = Route.useParams();
	const { pending, signedIn, owned } = useRequireSystem(serial);

	if (pending) return <Loading />;
	if (!signedIn || !owned) return null;

	return <PumpSlotList serial={serial} />;
}
