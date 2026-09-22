import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Waves } from "lucide-react";

/**
 * Shared app chrome. The mark leads back to the section it names — the system
 * page from equipment, the list from a system — which is the way out of a tab,
 * since tabs carry no back control. `children` are the right-aligned actions
 * each route supplies.
 */
export function AppHeader({
	title,
	Icon = Waves,
	onBack,
	to,
	params,
	children,
}: {
	/** Resolved by the layout; empty while the right title is still unknown. */
	title?: string;
	/** Waves is the app mark; the systems list passes its own. */
	Icon?: React.ComponentType<{ className?: string }>;
	/** Sub-pages swap the mark for a back control. */
	onBack?: () => void;
	/** Where the mark leads. Omitted where there is nowhere above to go. */
	to?: string;
	params?: Record<string, string>;
	children?: React.ReactNode;
}) {
	const heading = (
		<h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
	);
	const mark = <Icon className="size-5 shrink-0 text-accent" />;

	return (
		// Fixed to the top of the layout viewport, which without viewport-fit=cover
		// is the line under the status bar. WebKit hit-tests just inside that edge
		// for a fixed or sticky box at least 90% of the viewport wide; finding this
		// one, it samples the colour at its top (the near-solid tint of the glass
		// below), paints the status bar in it, and hides the Liquid Glass pocket
		// it would otherwise draw there.
		// The faint plain background is for WebKit, not the eye: with no plain
		// colour to read it samples the bar's pixels once and keeps that colour
		// for as long as this element is the edge container, so a theme switch
		// left the status bar in the old theme's colour. A plain colour is read
		// from style on every pass, and one this translucent is blended onto the
		// page background, which is the colour wanted anyway.
		// Fixed rather than sticky so the bar stays put while the page
		// rubber-bands. Full-bleed, with the row centred to the page width; the
		// layout reserves the bar's height (inset + 0.5rem + 36px + 0.5rem).
		<header className="fixed inset-x-0 top-0 z-30 bg-background/5 ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
			{/* The bar's glass and the soft edge below it — see .scroll-edge in
			    styles.css. Five bands: four of blur, one of tint. */}
			<div aria-hidden className="scroll-edge">
				<span />
				<span />
				<span />
				<span />
				<span />
			</div>
			{/* relative: painted above the bands, so the row stays crisp. */}
			<div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
				<div
					className={`flex min-w-0 items-center ${onBack ? "gap-0.5" : "gap-2.5"}`}
				>
					{onBack ? (
						<>
							{/* Negative inline start pulls the button's glyph out to the
						    same optical edge the bare icon sat on. */}
							<IconBtn className="-ms-2.5" label="Back" onPress={onBack}>
								<ChevronLeft className="size-6 text-foreground" />
							</IconBtn>
							{heading}
						</>
					) : to ? (
						// Mark and name are one target: the name is what you are
						// leaving, so it should be the thing you press. The pair is
						// wide enough to press without padding, and padding here only
						// pushed the focus ring away from what it is ringing.
						<Link
							className="link flex min-w-0 items-center gap-2.5 rounded-lg text-foreground no-underline"
							params={params}
							to={to}
						>
							{mark}
							{heading}
						</Link>
					) : (
						<>
							{mark}
							{heading}
						</>
					)}
				</div>
				<div className="flex items-center gap-2">{children}</div>
			</div>
		</header>
	);
}

export function IconBtn({
	label,
	children,
	onPress,
	disabled,
	to,
	params,
	className,
}: {
	label: string;
	children: React.ReactNode;
	onPress?: () => void;
	disabled?: boolean;
	to?: string;
	/** Route params when `to` is a template path like /systems/$serial/settings. */
	params?: Record<string, string>;
	className?: string;
}) {
	if (to) {
		// The button's own classes on an anchor, rather than Button rendering one
		// through `render`: it builds a <button> and warns when handed an <a>,
		// because the props it wires up are typed and behave as a button's. The
		// BEM classes are the documented way to give a link the same look.
		return (
			<Link
				aria-label={label}
				className={`link button button--sm button--ghost button--icon-only no-underline ${className ?? ""}`}
				params={params}
				to={to}
			>
				{children}
			</Link>
		);
	}
	return (
		<Button
			className={className}
			isIconOnly
			size="sm"
			variant="ghost"
			aria-label={label}
			isDisabled={disabled}
			onPress={onPress}
		>
			{children}
		</Button>
	);
}
