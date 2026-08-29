import { Button, Card } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	account,
	api,
	listSystems,
	sessionMeta,
	snapshot,
} from "#/lib/aqualink/client";

export const Route = createFileRoute("/diagnostics")({
	component: Diagnostics,
});

/**
 * Ground-truth harvester. Click a row, get the raw JSON back from the real
 * API using the live browser session.
 */
function Diagnostics() {
	const [out, setOut] = useState("—");
	const [busy, setBusy] = useState("");
	const meta = sessionMeta();

	async function probe(label: string, run: () => Promise<unknown>) {
		setBusy(label);
		try {
			setOut(JSON.stringify(await run(), null, 2));
		} catch (e) {
			setOut(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy("");
		}
	}

	const systems = () => listSystems();

	const home = async () => {
		const list = await listSystems();
		if (!list[0]?.serial) return "no systems";
		return snapshot(String(list[0].serial));
	};

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<h1 className="mb-1 text-xl font-semibold tracking-tight">Diagnostics</h1>
			<p className="mb-4 text-xs opacity-50">
				userId {meta.userId || "?"} · country {meta.country || "?"}
			</p>

			<div className="mb-4 flex flex-wrap gap-2">
				<Button size="sm" onPress={() => probe("account", account)}>
					account
				</Button>
				<Button size="sm" onPress={() => probe("locations", systems)}>
					locations
				</Button>
				<Button size="sm" onPress={() => probe("userId", () => api("/userId"))}>
					userId
				</Button>
				<Button size="sm" onPress={() => probe("home", home)}>
					home (get_home + get_devices)
				</Button>
			</div>

			<Card className="p-3">
				<div className="mb-2 flex items-center justify-between">
					<span className="text-xs uppercase tracking-widest opacity-50">
						{busy || "response"}
					</span>
				</div>
				<pre className="max-h-[60vh] overflow-auto text-[11px] leading-relaxed">
					{out}
				</pre>
			</Card>
		</main>
	);
}
