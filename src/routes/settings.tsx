import { createFileRoute } from "@tanstack/react-router";
import { Loading } from "#/components/loading";
import { AccountSettingsRows } from "#/components/settings-rows";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/settings")({
	component: Settings,
});

/** Account-level only. Renaming needs a system, which the URL doesn't name here. */
function Settings() {
	const { pending, signedIn } = useRequireSession();

	if (pending) return <Loading />;
	if (!signedIn) return null;

	return (
		<div className="space-y-4">
			<AccountSettingsRows />
		</div>
	);
}
