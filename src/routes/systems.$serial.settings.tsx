import { createFileRoute } from "@tanstack/react-router";
import { AddSystemRow } from "#/components/add-system";
import { CardColumns } from "#/components/card-columns";
import { Loading } from "#/components/loading";
import {
	AppearanceRow,
	DiagnosticsRow,
	InstallRow,
	MySystemsRow,
	PanelModelRow,
	SignOutRow,
	SystemNameRow,
	SystemSerialRow,
	WebTouchRow,
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
		<CardColumns>
			<SystemNameRow serial={serial} />
			<SystemSerialRow serial={serial} />
			<PanelModelRow serial={serial} />
			<AppearanceRow />
			<InstallRow />
			<AddSystemRow />
			<WebTouchRow serial={serial} />
			<DiagnosticsRow serial={serial} />
			<MySystemsRow serial={serial} />
			<SignOutRow />
		</CardColumns>
	);
}
