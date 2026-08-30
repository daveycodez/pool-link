import { AlertDialog, Button, Card, NumberField } from "@heroui/react";
import { TestTube, Zap } from "lucide-react";
import { useState } from "react";
import { CardColumns } from "#/components/card-columns";
import { IconCircle } from "#/components/device-row";
import {
	type ChemPresence,
	calibrationAge,
	isCalibrating,
	PH_REFERENCE,
	type PhOrpCalibration,
} from "#/lib/chemistry";
import { useCalibrate } from "#/lib/queries";

/**
 * The TruSense probe's calibration, as maintenance rather than as a reading.
 *
 * It sits on the equipment page and not in the hero's chemistry chips, and the
 * split is the same one the whole page is built on. The hero answers "what is
 * the water doing", which is a number that changes while you watch it; this
 * answers "is the thing measuring the water still telling the truth", which
 * changes when somebody goes and does something about it. A date last touched
 * eight months ago has no business sitting in a row that refreshes every ten
 * seconds, and the buttons underneath it — which rewrite a physical sensor —
 * have no business anywhere near a screen people tap at speed.
 *
 * The equipment page already hosts exactly this kind of card: the salt cell and
 * the heat pump both appear only where the panel says the hardware is fitted,
 * and both are configuration rather than telemetry. This is the third.
 *
 * Nothing renders unless the panel has named a channel present *and* answered
 * the calibration read. On a pad with no probe — which is nearly all of them,
 * and this one — the section does not exist and no request was ever sent to
 * build it.
 */
export function ProbeCalibration({
	serial,
	calibration,
	phPresence,
	orpPresence,
}: {
	serial: string;
	/** Null until the gated read answers, and forever on a pad without a probe. */
	calibration: PhOrpCalibration | null;
	phPresence: ChemPresence;
	orpPresence: ChemPresence;
}) {
	const calibrate = useCalibrate(serial);
	if (!calibration) return null;

	// One field covers both channels, so a procedure running on either locks
	// both — which is what the panel is doing anyway, since there is one probe.
	const busy = isCalibrating(calibration.status);
	const running = busy || calibrate.isPending;
	const ph = phPresence === "present";
	const orp = orpPresence === "present";
	if (!ph && !orp) return null;

	return (
		<div className="space-y-4">
			<h2 className="px-1 text-sm font-medium text-muted">Probe Calibration</h2>
			<CardColumns>
				{ph ? (
					<CalibrationCard
						busy={running}
						calibratedAt={calibration.phCalibratedAt}
						icon={<TestTube className="size-4" />}
						isCalibrated={calibration.phCalibrated}
						status={calibration.status}
						title="pH"
					>
						<PhCalibrationDialog
							isDisabled={running}
							onConfirm={(phValue) => calibrate.mutate({ kind: "ph", phValue })}
						/>
					</CalibrationCard>
				) : null}

				{orp ? (
					<CalibrationCard
						busy={running}
						calibratedAt={calibration.orpCalibratedAt}
						icon={<Zap className="size-4" />}
						isCalibrated={calibration.orpCalibrated}
						status={calibration.status}
						title="ORP"
					>
						<OrpCalibrationDialog
							isDisabled={running}
							onConfirm={() => calibrate.mutate({ kind: "orp" })}
						/>
					</CalibrationCard>
				) : null}
			</CardColumns>
		</div>
	);
}

/**
 * One channel's calibration state and the button that changes it.
 *
 * "Never calibrated" is the only caption that takes a colour, and it earns it
 * from the panel's own boolean rather than from a threshold this app invented.
 * An age is left plain, and that is a decision rather than an omission: Jandy
 * recommends calibrating these sensors monthly, which is a real published
 * interval and also one almost nobody keeps. Painting every probe amber four
 * weeks after it was last done would put the warning colour on very nearly every
 * probe that exists, and a colour that is always on says nothing. The date is
 * shown plainly and the owner can decide what eight months means to them.
 */
function CalibrationCard({
	title,
	icon,
	isCalibrated,
	calibratedAt,
	status,
	busy,
	children,
}: {
	title: string;
	icon: React.ReactNode;
	isCalibrated: boolean;
	calibratedAt: Date | null;
	/** The panel's own status word, shown verbatim while something is running. */
	status: string;
	busy: boolean;
	children: React.ReactNode;
}) {
	const never = !isCalibrated;
	return (
		<Card className="flex-row items-center justify-between gap-4">
			<div className="flex items-center gap-4">
				<IconCircle on={busy}>{icon}</IconCircle>
				<div className="min-w-0">
					<Card.Title>{title}</Card.Title>
					<Card.Description className={never && !busy ? "text-warning" : ""}>
						{isCalibrating(status)
							? `Calibrating — panel reports ${status}`
							: never
								? "Never calibrated"
								: calibratedAt
									? `Calibrated ${calibrationAge(calibratedAt)}`
									: // Calibrated, but the panel's date field was not one this
										// code could read. Better to say the true half than to
										// invent an age out of it.
										"Calibrated"}
					</Card.Description>
				</div>
			</div>
			{children}
		</Card>
	);
}

/**
 * The button and its confirmation. Never a one-tap action: the tap opens a
 * dialog that says what is about to happen to the hardware, and the dialog is
 * where the commitment is made.
 *
 * Failures are not repeated inside the dialog because the app already raises
 * every mutation error as a toast, from the mutation cache — and the dialog has
 * closed by then, so a message written into it would be a message nobody reads.
 */
function CalibrationDialog({
	heading,
	confirmLabel = "Calibrate",
	isDisabled,
	isConfirmDisabled,
	onOpen,
	onConfirm,
	children,
}: {
	heading: string;
	confirmLabel?: string;
	isDisabled: boolean;
	isConfirmDisabled?: boolean;
	onOpen?: () => void;
	onConfirm: () => void;
	children: React.ReactNode;
}) {
	return (
		<AlertDialog>
			<Button
				isDisabled={isDisabled}
				onPress={onOpen}
				size="sm"
				variant="secondary"
			>
				Calibrate
			</Button>
			<AlertDialog.Backdrop>
				<AlertDialog.Container>
					<AlertDialog.Dialog>
						<AlertDialog.Header>
							<AlertDialog.Heading>{heading}</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>{children}</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button slot="close" variant="tertiary">
								Cancel
							</Button>
							<Button
								isDisabled={isConfirmDisabled}
								onPress={onConfirm}
								slot="close"
							>
								{confirmLabel}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</AlertDialog>
	);
}

/**
 * One-point pH calibration, which is the one command here that carries a number
 * the operator has to be right about.
 *
 * The copy is the manual's procedure and not this app's paraphrase of it: a
 * sample of pool water in a clean non-metal container, measured, with the sensor
 * sitting in that same sample when the command goes. That last part is the piece
 * a single dialog most easily loses — the official app collects the number and
 * starts the calibration at two different points in the procedure, and here they
 * are one button, so the button has to say what must already be true when it is
 * pressed. The pump-off and not-in-service-mode preconditions are the manual's
 * too, and nothing here can check either of them.
 *
 * The field opens empty rather than pre-filled with a plausible pH. A default of
 * 7.4 is a value somebody can confirm without ever having read a test kit, and
 * the whole purpose of the number is that it came from a measurement — so there
 * is nothing to type past, and the confirm button stays dead until a real value
 * is in the box. The bounds are in `PH_REFERENCE` with the reasoning for their
 * width.
 */
function PhCalibrationDialog({
	isDisabled,
	onConfirm,
}: {
	isDisabled: boolean;
	onConfirm: (phValue: number) => void;
}) {
	// NaN is React Aria's empty, and it is also exactly the value that must not
	// reach the panel — so the same check gates the button and the send.
	const [value, setValue] = useState(Number.NaN);
	const valid =
		Number.isFinite(value) &&
		value >= PH_REFERENCE.min &&
		value <= PH_REFERENCE.max;

	return (
		<CalibrationDialog
			heading="Calibrate pH"
			isConfirmDisabled={!valid}
			isDisabled={isDisabled}
			onConfirm={() => valid && onConfirm(value)}
			onOpen={() => setValue(Number.NaN)}
		>
			<p className="text-sm text-muted">
				Fill a clean glass or plastic container — never metal — with pool water,
				measure its pH, and put the sensor in that same sample. Enter the
				measured pH below and start. The pump should be off at the breaker and
				the system in Auto rather than Service.
			</p>
			<p className="mt-3 text-sm text-muted">
				This replaces the pH sensor's reference. A wrong number here does not
				look wrong afterwards — it makes every pH the app shows wrong by the
				same amount until the probe is calibrated again.
			</p>
			<NumberField
				aria-label="Measured pH"
				className="mt-4"
				formatOptions={{
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				}}
				maxValue={PH_REFERENCE.max}
				minValue={PH_REFERENCE.min}
				onChange={setValue}
				step={PH_REFERENCE.step}
				value={value}
				variant="secondary"
			>
				<NumberField.Group>
					<NumberField.DecrementButton />
					<NumberField.Input
						className="w-16 text-center"
						placeholder="Measured pH"
					/>
					<NumberField.IncrementButton />
				</NumberField.Group>
			</NumberField>
		</CalibrationDialog>
	);
}

/**
 * ORP calibration, which carries no value at all.
 *
 * `do_orp_calibration` takes only the unit id, and the manual explains why: the
 * reference is a 470 mV buffer solution and the panel already knows that, so
 * there is no number to send and none to get wrong. What is left to get wrong is
 * the moment — the sensor has to already be sitting in the buffer when the
 * command goes — which is the one thing the dialog exists to say.
 *
 * The buffer is named rather than left to the manual, because it is the whole
 * precondition and a dialog that says "follow the instructions" is a dialog that
 * has declined to be useful. The alternates the manual accepts (460 and 468 mV)
 * are left out: they are close enough to be interchangeable in practice, and
 * listing three numbers where the packaging says one invites somebody to think
 * the choice matters here.
 */
function OrpCalibrationDialog({
	isDisabled,
	onConfirm,
}: {
	isDisabled: boolean;
	onConfirm: () => void;
}) {
	return (
		<CalibrationDialog
			heading="Calibrate ORP"
			isDisabled={isDisabled}
			onConfirm={onConfirm}
		>
			<p className="text-sm text-muted">
				Submerge the sensor in ORP 470 mV buffer solution before you start —
				this sends no value, the panel calibrates against that reference on its
				own. The pump should be off at the breaker and the system in Auto rather
				than Service.
			</p>
			<p className="mt-3 text-sm text-muted">
				This replaces the ORP sensor's existing calibration. Every ORP reading
				afterwards is measured against the new reference.
			</p>
		</CalibrationDialog>
	);
}
