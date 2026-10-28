// Buttons (DG p. 33): primary Cinder/white, secondary white with a Cinder border, tertiary with a 2 px bottom stroke,
// text plain; square corners; at least 44 px high. `critical` exists only inside ConfirmDialog.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "text";

const cls = (variant: ButtonVariant | "critical", extra?: string) =>
  extra ? `v13-btn v13-btn-${variant} ${extra}` : `v13-btn v13-btn-${variant}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  testId?: string;
}

export function Button({ variant, testId, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cls(variant, className)} data-testid={testId} {...rest} />;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant: ButtonVariant;
  href: string;
  testId?: string;
}

/** A link styled as a button, for navigation (never for a command). */
export function ButtonLink({ variant, testId, className, children, ...rest }: ButtonLinkProps) {
  return (
    <a className={cls(variant, className)} data-testid={testId} {...rest}>
      {children}
    </a>
  );
}

/** Internal: the destructive button of a confirmation dialog. */
export function criticalClass(): string {
  return cls("critical");
}
