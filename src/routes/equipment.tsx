import { Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { EquipmentRow } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { useActuate } from "#/lib/queries";
import { usePool, useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/equipment")({
	component: Equipment,
});

function Equipment() {
	const { pending, signedIn } = useRequireSession();
	const { serial, controls, loading } = usePool();
	const actuate = useActuate(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	if (controls.length === 0) {
		return (
			<Card className="text-sm text-muted">
				No controllable equipment found.
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{controls.map((d) => (
				<EquipmentRow
					key={d.id}
					device={d}
					busy={actuate.isPending}
					onToggle={(on) => actuate.mutate({ device: d, on })}
				/>
			))}
		</div>
	);
}
