import { createFileRoute } from "@tanstack/react-router";
import { AddSystemRow } from "#/components/add-system";
import { CardColumns } from "#/components/card-columns";
import { Loading } from "#/components/loading";
import {
	AppearanceRow,
	DiagnosticsRow,
	InstallRow,
	SignOutRow,
} from "#/components/settings-rows";
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
		<CardColumns>
			<AppearanceRow />
			<InstallRow />
			<DiagnosticsRow />
			<AddSystemRow />
			<SignOutRow />
		</CardColumns>
	);
}
