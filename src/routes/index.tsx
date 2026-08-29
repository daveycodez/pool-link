import type { Key } from "@heroui/react";
import { Card, Chip, ListBox, Select, Spinner, Switch } from "@heroui/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	Droplets,
	Flame,
	Lightbulb,
	LogOut,
	RefreshCw,
	Settings,
	SlidersHorizontal,
	Thermometer,
	Waves,
	WavesArrowDown,
	Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { JANDY_WATERCOLORS, WATERCOLOR_HEX } from "#/lib/aqualink/enums";
import type { PoolDevice } from "#/lib/iaqualink/types";
import {
	useActuate,
	useLightColor,
	useLogout,
	useSession,
	useSetTemps,
	useSnapshot,
	useSystems,
} from "#/lib/queries";

export const Route = createFileRoute("/")({
	component: Dashboard,
});

function Dashboard() {
	const navigate = useNavigate();
	const session = useSession();
	const logout = useLogout();

	useEffect(() => {
		if (!session.isPending && !session.data)
			navigate({ to: "/login", replace: true });
	}, [session.isPending, session.data, navigate]);

	if (session.isPending) return <Booting />;
	if (!session.data) return <Booting />;

	return <PoolView onLogout={() => logout.mutate()} />;
}

function Booting() {
	return (
		<main className="flex min-h-dvh items-center justify-center">
			<div className="flex flex-col items-center gap-3 text-muted">
				<div data-pulse className="size-2.5 rounded-full bg-accent" />
				<p className="text-sm">Connecting to pool…</p>
			</div>
		</main>
	);
}

function PoolView({ onLogout }: { onLogout: () => void }) {
	const systems = useSystems(true);
	const serial = systems.data?.[0]?.serial;
	const snap = useSnapshot(serial);
	const actuate = useActuate(serial);
	const setTemps = useSetTemps(serial);
	const lightColor = useLightColor(serial);
	const [tab, setTab] = useState<"pool" | "equipment">("pool");

	const devices = snap.data?.devices ?? [];
	const byName = new Map(devices.map((d) => [d.name, d]));
	const pool = byName.get("pool_temp");
	const spa = byName.get("spa_temp");
	const air = byName.get("air_temp");
	const spaMode = Boolean(spa?.value) && !pool?.value;
	const water = spaMode ? spa : pool;
	const poolSet = byName.get("pool_set_point");
	const spaSet = byName.get("spa_set_point");
	const heaters = devices.filter(
		(d) =>
			d.kind === "climate" &&
			d.name.endsWith("_heater") &&
			d.name !== "solar_heater",
	);
	const light = devices.find((d) => d.kind === "light");
	const jetPump = byName.get("aux_2");
	const waterfall = byName.get("aux_1");
	const genericAux = /^aux\s+v\d+$/i;
	const controls = devices.filter(
		(d) =>
			d.kind === "pump" ||
			d.name === "solar_heater" ||
			(["switch", "dimmer"].includes(d.kind) &&
				d.name !== "aux_1" &&
				d.name !== "aux_2" &&
				(d.on || !genericAux.test(d.label))),
	);

	const live = snap.isSuccess && !snap.isStale;
	const loading = systems.isPending || snap.isPending;

	return (
		<div className="mx-auto w-full max-w-md px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
			<Header
				live={live}
				refreshing={snap.isFetching}
				onRefresh={() => snap.refetch()}
				onLogout={onLogout}
			/>

			{snap.isError ? (
				<Card className="mb-4 p-4 text-sm text-danger">
					Couldn’t reach the pool. {snap.error.message}
				</Card>
			) : null}

			{loading ? (
				<div className="flex min-h-[55dvh] items-center justify-center">
					<Spinner color="accent" size="lg" />
				</div>
			) : tab === "pool" ? (
				<PoolScreen
					water={water}
					spaMode={spaMode}
					air={air}
					heaters={heaters}
					jetPump={jetPump}
					waterfall={waterfall}
					poolSet={poolSet}
					spaSet={spaSet}
					light={light}
					busy={actuate.isPending || setTemps.isPending || lightColor.isPending}
					onToggle={(d, on) => actuate.mutate({ device: d, on })}
					onSetTemps={(sp, pl) => setTemps.mutate({ spa: sp, pool: pl })}
					onLightColor={(effectId) =>
						light
							? lightColor.mutate({
									name: light.name,
									subtype:
										typeof light.raw.subtype === "string"
											? light.raw.subtype
											: "",
									effectId,
								})
							: undefined
					}
					fetchedAt={snap.data?.fetchedAt}
				/>
			) : (
				<EquipmentScreen
					controls={controls}
					busy={actuate.isPending}
					onToggle={(d, on) => actuate.mutate({ device: d, on })}
				/>
			)}

			<BottomNav tab={tab} onTab={setTab} />
		</div>
	);
}

function Header({
	live,
	refreshing,
	onRefresh,
	onLogout,
}: {
	live: boolean;
	refreshing: boolean;
	onRefresh: () => void;
	onLogout: () => void;
}) {
	return (
		<header className="mb-4 flex items-center justify-between">
			<div className="flex items-center gap-2.5">
				<Waves className="size-5 text-accent" />
				<h1 className="text-lg font-semibold tracking-tight">Pool Link</h1>
			</div>
			<div className="flex items-center gap-1">
				<Chip color={live ? "success" : "warning"} size="sm" variant="soft">
					{live ? "Live" : "Stale"}
				</Chip>
				<IconBtn label="Refresh" onPress={onRefresh} disabled={refreshing}>
					<RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
				</IconBtn>
				<IconBtn label="Diagnostics" as={Link} to="/diagnostics">
					<Settings className="size-4" />
				</IconBtn>
				<IconBtn label="Sign out" onPress={onLogout}>
					<LogOut className="size-4" />
				</IconBtn>
			</div>
		</header>
	);
}

function PoolScreen({
	water,
	spaMode,
	air,
	heaters,
	jetPump,
	waterfall,
	poolSet,
	spaSet,
	light,
	busy,
	onToggle,
	onSetTemps,
	onLightColor,
	fetchedAt,
}: {
	water: PoolDevice | undefined;
	spaMode: boolean;
	air: PoolDevice | undefined;
	heaters: PoolDevice[];
	jetPump: PoolDevice | undefined;
	waterfall: PoolDevice | undefined;
	poolSet: PoolDevice | undefined;
	spaSet: PoolDevice | undefined;
	light: PoolDevice | undefined;
	busy: boolean;
	onToggle: (d: PoolDevice, on: boolean) => void;
	onSetTemps: (spa: string, pool: string) => void;
	onLightColor: (effectId: number) => void;
	fetchedAt: number | undefined;
}) {
	return (
		<div className="space-y-4">
			<Card className="relative overflow-hidden p-6">
				<div
					aria-hidden
					className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full"
					style={{
						background:
							"radial-gradient(circle, color-mix(in oklab, var(--accent) 12%, transparent) 0%, transparent 75%)",
					}}
				/>
				<div className="flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-widest text-muted">
					<div className="flex items-center gap-2">
						{spaMode ? (
							<Flame className="size-4 text-orange-500" />
						) : (
							<Waves className="size-4 text-accent" />
						)}
						{spaMode ? "Spa Mode" : "Pool"}
					</div>
					{air ? (
						<div className="flex items-center gap-1.5">
							<Thermometer className="size-4 text-accent" />
							<span className="tabular-nums">
								Air {air.value ?? "—"}
								{air.unit ?? "°"}
							</span>
						</div>
					) : null}
				</div>
				<div className="mt-2 flex items-baseline gap-1.5 leading-none">
					<span className="text-7xl font-semibold tabular-nums tracking-tighter">
						{water?.value ?? "—"}
					</span>
					<span className="text-2xl text-muted">{water?.unit ?? "°"}</span>
				</div>
			</Card>

			{heaters.flatMap((d) => {
				const isSpa = d.name.startsWith("spa");
				const items: React.ReactNode[] = [
					<HeaterTempControl
						key={d.id}
						device={d}
						setPoint={isSpa ? spaSet?.value : poolSet?.value}
						busy={busy}
						onTemp={(t) =>
							isSpa
								? onSetTemps(t, poolSet?.value ?? "")
								: onSetTemps(spaSet?.value ?? "", t)
						}
						onOff={() => onToggle(d, false)}
					/>,
				];
				if (isSpa && jetPump) {
					items.push(
						<EquipmentRow
							key={`${d.id}-pump`}
							device={jetPump}
							busy={busy}
							onToggle={(on) => onToggle(jetPump, on)}
						/>,
					);
				}
				return items;
			})}

			{light ? (
				<LightCard
					device={light}
					busy={busy}
					onToggle={(on) => onToggle(light, on)}
					onColor={onLightColor}
				/>
			) : null}

			{waterfall ? (
				<EquipmentRow
					device={waterfall}
					busy={busy}
					onToggle={(on) => onToggle(waterfall, on)}
				/>
			) : null}

			{fetchedAt ? (
				<p className="pt-4 text-center text-xs text-muted">
					Updated {new Date(fetchedAt).toLocaleTimeString()}
				</p>
			) : null}
		</div>
	);
}

function EquipmentScreen({
	controls,
	busy,
	onToggle,
}: {
	controls: PoolDevice[];
	busy: boolean;
	onToggle: (d: PoolDevice, on: boolean) => void;
}) {
	return (
		<div>
			<h2 className="mb-3 text-sm font-medium text-muted">Equipment</h2>
			{controls.length === 0 ? (
				<Card className="p-4 text-sm text-muted">
					No controllable equipment found.
				</Card>
			) : (
				<div className="space-y-4">
					{controls.map((d) => (
						<EquipmentRow
							key={d.id}
							device={d}
							busy={busy}
							onToggle={(on) => onToggle(d, on)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

const SPA_TEMP_OPTIONS = Array.from({ length: 7 }, (_, i) => 98 + i);
const POOL_TEMP_OPTIONS = Array.from({ length: 6 }, (_, i) => 78 + i * 2);

function HeaterTempControl({
	device,
	setPoint,
	busy,
	onTemp,
	onOff,
}: {
	device: PoolDevice;
	setPoint?: string | null;
	busy: boolean;
	onTemp: (temp: string) => void;
	onOff: () => void;
}) {
	const isSpa = device.name.startsWith("spa");
	const options = isSpa ? SPA_TEMP_OPTIONS : POOL_TEMP_OPTIONS;
	const value = device.on && setPoint ? setPoint : "off";
	return (
		<Card className="flex-row items-center justify-between gap-3 p-4">
			<div className="flex items-center gap-3">
				<div
					className={`flex size-9 items-center justify-center rounded-full ${
						device.on
							? "bg-orange-500/15 text-orange-500"
							: "bg-surface-secondary text-muted"
					}`}
				>
					<Flame className="size-4" />
				</div>
				<p className="text-sm font-medium">{device.label}</p>
			</div>
			<Select
				aria-label={`${device.label} temperature`}
				value={value}
				isDisabled={busy}
				onChange={(v) => (v === "off" ? onOff() : onTemp(String(v)))}
				className="w-24"
				variant="secondary"
			>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						<ListBox.Item id="off" textValue="Off">
							Off
							<ListBox.ItemIndicator />
						</ListBox.Item>
						{options.map((t) => (
							<ListBox.Item key={t} id={String(t)} textValue={`${t}°`}>
								{t}°
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
		</Card>
	);
}

function LightCard({
	device,
	busy,
	onToggle,
	onColor,
}: {
	device: PoolDevice;
	busy: boolean;
	onToggle: (on: boolean) => void;
	onColor: (effectId: number) => void;
}) {
	const colors = Object.entries(JANDY_WATERCOLORS).filter(([, id]) => id > 0);
	// The API only reports on/off for a light, not the current color, so we
	// show a neutral "On" until the user picks one.
	const [picked, setPicked] = useState<string | null>(null);
	const value: Key = device.on ? (picked ?? "__on") : "off";
	const showPlaceholder = device.on && picked === null;

	return (
		<Card className="flex-row items-center justify-between gap-3 p-4">
			<div className="flex items-center gap-3">
				<div className="flex size-9 items-center justify-center rounded-full bg-surface-secondary text-accent">
					<Lightbulb className="size-4" />
				</div>
				<p className="text-sm font-medium">{device.label}</p>
			</div>
			<Select
				aria-label={`${device.label} mode`}
				value={value}
				isDisabled={busy}
				onChange={(v) => {
					if (v === "off") {
						setPicked(null);
						onToggle(false);
					} else if (v !== "__on") {
						const name = String(v);
						setPicked(name);
						onColor(JANDY_WATERCOLORS[name]);
					}
				}}
				className="w-40"
				variant="secondary"
			>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						<ListBox.Item id="off" textValue="Off">
							Off
							<ListBox.ItemIndicator />
						</ListBox.Item>
						{showPlaceholder ? (
							<ListBox.Item id="__on" textValue="On">
								On
								<ListBox.ItemIndicator />
							</ListBox.Item>
						) : null}
						{colors.map(([name]) => (
							<ListBox.Item key={name} id={name} textValue={name}>
								<span className="flex items-center gap-2">
									<span
										className="size-3 shrink-0 rounded-full"
										style={{ backgroundColor: WATERCOLOR_HEX[name] }}
									/>
									{name}
								</span>
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
		</Card>
	);
}

function EquipmentRow({
	device,
	busy,
	onToggle,
}: {
	device: PoolDevice;
	busy: boolean;
	onToggle: (on: boolean) => void;
}) {
	return (
		<Card className="flex-row items-center justify-between gap-4 p-4">
			<div className="flex items-center gap-3">
				<div className="flex size-9 items-center justify-center rounded-full bg-surface-secondary text-muted">
					<DeviceIcon device={device} />
				</div>
				<div>
					<p className="text-sm font-medium">{device.label}</p>
					{device.dimLevel !== null ? (
						<p className="text-xs text-muted">{device.dimLevel}%</p>
					) : null}
				</div>
			</div>
			<Switch
				aria-label={device.label}
				isSelected={device.on}
				isDisabled={busy}
				onChange={(on: boolean) => onToggle(on)}
			>
				<Switch.Content>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch.Content>
			</Switch>
		</Card>
	);
}

function DeviceIcon({ device }: { device: PoolDevice }) {
	if (device.name === "aux_1") return <WavesArrowDown className="size-4" />;
	if (device.name === "aux_2") return <Droplets className="size-4" />;
	switch (device.kind) {
		case "light":
			return <Lightbulb className="size-4" />;
		case "dimmer":
			return <SlidersHorizontal className="size-4" />;
		case "pump":
			return <Droplets className="size-4" />;
		case "climate":
			return <Flame className="size-4" />;
		default:
			return <Zap className="size-4" />;
	}
}

function BottomNav({
	tab,
	onTab,
}: {
	tab: "pool" | "equipment";
	onTab: (t: "pool" | "equipment") => void;
}) {
	return (
		<nav className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex justify-center">
			<div className="flex items-center gap-1 rounded-full border border-border bg-surface/90 p-1 shadow-lg backdrop-blur">
				<TabBtn active={tab === "pool"} onPress={() => onTab("pool")}>
					<Waves className="size-4" />
					Pool
				</TabBtn>
				<TabBtn active={tab === "equipment"} onPress={() => onTab("equipment")}>
					<SlidersHorizontal className="size-4" />
					Equipment
				</TabBtn>
			</div>
		</nav>
	);
}

function TabBtn({
	active,
	onPress,
	children,
}: {
	active: boolean;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onPress}
			className={`flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
				active
					? "bg-accent text-accent-foreground"
					: "text-muted hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

function IconBtn({
	label,
	children,
	onPress,
	disabled,
	as,
	to,
}: {
	label: string;
	children: React.ReactNode;
	onPress?: () => void;
	disabled?: boolean;
	as?: "a" | typeof Link;
	to?: string;
}) {
	const classes =
		"flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-secondary hover:text-foreground disabled:opacity-50";
	if (as === Link) {
		return (
			<Link
				to={to as string}
				aria-label={label}
				title={label}
				className={classes}
			>
				{children}
			</Link>
		);
	}
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onPress}
			className={classes}
		>
			{children}
		</button>
	);
}
