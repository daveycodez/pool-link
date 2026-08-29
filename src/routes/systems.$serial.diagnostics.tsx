import { createFileRoute } from "@tanstack/react-router";
import { DiagnosticsPanel } from "#/components/diagnostics-panel";
import { Loading } from "#/components/loading";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/diagnostics")({
	component: SystemDiagnostics,
});

/** The account probes plus this system's screens and VSP commands. */
function SystemDiagnostics() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();

	if (pending) return <Loading />;
	if (!signedIn) return null;

	return <DiagnosticsPanel serial={serial} />;
}
