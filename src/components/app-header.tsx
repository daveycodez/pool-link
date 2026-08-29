import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Waves } from "lucide-react";

/**
 * Shared app chrome. The wordmark is a label, not navigation — routes provide
 * their own way back; `children` are the right-aligned actions each route
 * supplies.
 */
export function AppHeader({
	title,
	Icon = Waves,
	onBack,
	children,
}: {
	/** Resolved by the layout; empty while the right title is still unknown. */
	title?: string;
	/** Waves is the app mark; the systems list passes its own. */
	Icon?: React.ComponentType<{ className?: string }>;
	/** Sub-pages swap the mark for a back control. */
	onBack?: () => void;
	children?: React.ReactNode;
}) {
	return (
		<header className="mb-2 flex items-center justify-between gap-4">
			<div
				className={`flex min-w-0 items-center ${onBack ? "gap-0.5" : "gap-2.5"}`}
			>
				{onBack ? (
					// Negative inline start pulls the button's glyph out to the same
					// optical edge the bare icon sat on.
					<IconBtn className="-ms-2.5" label="Back" onPress={onBack}>
						<ChevronLeft className="size-6 text-foreground" />
					</IconBtn>
				) : (
					<Icon className="size-5 shrink-0 text-accent" />
				)}
				<h1 className="truncate text-lg font-semibold tracking-tight">
					{title}
				</h1>
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
