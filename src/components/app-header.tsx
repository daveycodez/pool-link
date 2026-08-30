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
		<header className="mb-2 flex items-center justify-between gap-4">
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
		return (
			<Button
				isIconOnly
				size="sm"
				variant="ghost"
				aria-label={label}
				// Button renders a <button>; swap in the router Link so the icon
				// button navigates. The cast is needed because the handler props
				// are typed against HTMLButtonElement, not HTMLAnchorElement.
				render={(props) => (
					<Link
						{...(props as unknown as React.ComponentPropsWithoutRef<"a">)}
						params={params}
						to={to}
					/>
				)}
			>
				{children}
			</Button>
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
