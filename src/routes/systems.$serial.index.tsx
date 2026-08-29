import type { Key } from "@heroui/react";
import { Card, ListBox, Select } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { Flame, Lightbulb, Thermometer, Waves } from "lucide-react";
import { useState } from "react";
import { EquipmentRow, IconCircle } from "#/components/device-row";
import { Loading } from "#/components/loading";
import { JANDY_WATERCOLORS, WATERCOLOR_HEX } from "#/lib/aqualink/enums";
import type { PoolDevice } from "#/lib/iaqualink/types";
import { useActuate, useLightColor, useSetTemps } from "#/lib/queries";
import { usePool, useRequireSession } from "#/lib/use-pool";

export const Route = createFileRoute("/systems/$serial/")({
	component: Pool,
});

function Pool() {
	const { serial } = Route.useParams();
	const { pending, signedIn } = useRequireSession();
	const {
		loading,
		spaMode,
		water,
		air,
		poolSet,
		spaSet,
		heaters,
		light,
		jetPump,
		waterfall,
	} = usePool(serial);
	const actuate = useActuate(serial);
	const setTemps = useSetTemps(serial);
	const lightColor = useLightColor(serial);

	if (pending || loading) return <Loading />;
	// No session: useRequireSession is already redirecting to /login.
	if (!signedIn) return null;

	return (
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
								typeof light.raw.subtype === "string" ? light.raw.subtype : "",
							effectId,
						})
					: undefined
			}
		/>
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
				<div className="flex items-center justify-between gap-4 text-[11px] font-medium uppercase tracking-widest text-muted">
					<div className="flex items-center gap-2">
						{spaMode ? (
							<Flame className="size-4 text-accent" />
						) : (
							<Waves className="size-4 text-accent" />
						)}
						{spaMode ? "Spa" : "Pool"}
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
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={device.on}>
					<Flame className="size-4" />
				</IconCircle>
				<Card.Title>{device.label}</Card.Title>
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
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={device.on}>
					<Lightbulb className="size-4" />
				</IconCircle>
				<Card.Title>{device.label}</Card.Title>
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
