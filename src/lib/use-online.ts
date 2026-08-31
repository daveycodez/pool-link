import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it can reach the network.
 *
 * Starts optimistic and stays that way through the first render: the
 * prerendered shell has no `navigator`, and a paint that claimed to be offline
 * before it had looked would be wrong far more often than right. The truth
 * lands on the render after mount, which is soon enough for something that
 * only ever adds a banner.
 */
export function useOnline(): boolean {
	const [online, setOnline] = useState(true);

	useEffect(() => {
		const sync = () => setOnline(navigator.onLine);
		sync();
		addEventListener("online", sync);
		addEventListener("offline", sync);
		return () => {
			removeEventListener("online", sync);
			removeEventListener("offline", sync);
		};
	}, []);

	return online;
}
