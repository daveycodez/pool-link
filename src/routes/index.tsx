import { Card, Chip } from "@heroui/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, House } from "lucide-react";
import { AddSystemRow } from "#/components/add-system";
import { IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import type { Raw, SystemSummary } from "#/lib/aqualink/types";
import { useDeviceStatus, useSystems } from "#/lib/queries";
import { useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/")({
	component: Systems,
});

function Systems() {
	const { pending, signedIn } = useRequireSession();
	const systems = useSystems(true);
	const list = systems.data ?? [];

	// A single system never reaches here: the layout redirects rather than
	// render this, since it holds the spinner that would otherwise flash.
	if (pending || systems.isPending) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	if (list.length === 0) {
		return (
			<Card className="text-sm text-muted">
				No systems on this iAqualink account.
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{list.map((system) => (
				<SystemCard key={system.serial} system={system} />
			))}
			<AddSystemRow />
		</div>
	);
}

function SystemCard({ system }: { system: SystemSummary }) {
	// The locations payload has no status, only a `statusLink` token, so online
	// state is a second request per card: {"status":{"Status":"Online",…}}.
	const status = useDeviceStatus(system.serial);
	const value = String((status.data?.status as Raw | undefined)?.Status ?? "");
	const online = value.toLowerCase() === "online";
	// Amber until the first response lands — an immediate red would read as a
	// real outage while the request is still in flight. Anything that comes
	// back other than Online is shown verbatim rather than flattened.
	const color = status.isPending ? "warning" : online ? "success" : "danger";
	const label = status.isPending ? "Loading" : value || "Unknown";

	return (
		<Link
			className="card-link"
			params={{ serial: system.serial }}
			to="/systems/$serial"
		>
			<Card className="flex-row items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-4">
					<IconCircle on={online}>
						<House className="size-4" />
					</IconCircle>
					<Card.Title className="truncate">{system.name}</Card.Title>
				</div>
				<div className="flex shrink-0 items-center gap-4">
					{/* Same swatch as the light colour picker. Colour alone carries the
					    meaning, so pair it with text for screen readers. */}
					<Chip color={color} size="sm" variant="soft">
						{label}
					</Chip>
					<ChevronRight className="size-5 text-muted" />
				</div>
			</Card>
		</Link>
	);
}
