import { createFileRoute } from "@tanstack/react-router";
import { Loading } from "#/components/loading";
import {
	AccountSettingsRows,
	SystemNameRow,
	SystemSerialRow,
} from "#/components/settings-rows";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/settings")({
	component: SystemSettings,
});

/** The account rows plus what only makes sense with a system in scope. */
function SystemSettings() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();

	if (pending) return <Loading />;
	if (!signedIn) return null;

	return (
		<div className="space-y-4">
			<SystemNameRow serial={serial} />
			<SystemSerialRow serial={serial} />
			<AccountSettingsRows serial={serial} />
		</div>
	);
}
