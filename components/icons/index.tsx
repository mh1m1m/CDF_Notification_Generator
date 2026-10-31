// Inline SVG icons (ADR-013): decorative only, always aria-hidden, drawn in currentColor so they follow the text token.
// Directional icons carry v13-icon-mirror, which flips them in RTL (DESIGN_SYSTEM.md §5); status glyphs never mirror.
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ className, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
      className={className ? `v13-icon ${className}` : "v13-icon"}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Laboratory flask: the synthetic-data banner glyph. */
export function FlaskIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 1.5h4M6.75 1.5v4.25L2.5 13.5v1h11v-1L9.25 5.75V1.5M4.25 10.5h7.5" />
    </Svg>
  );
}

/** Check mark: the current option of a menu. Not a status glyph. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8.5l3.5 3.5 7.5-8" />
    </Svg>
  );
}

/** Chevron pointing to the reading end (left in RTL after mirroring): breadcrumb separators. */
export function ChevronEndIcon({ className, ...props }: IconProps) {
  return (
    <Svg className={className ? `v13-icon-mirror ${className}` : "v13-icon-mirror"} {...props}>
      <path d="M6 3l5 5-5 5" />
    </Svg>
  );
}

/** Chevron pointing down: a disclosure that opens below its button. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6l5 5 5-5" />
    </Svg>
  );
}

/** Padlock: named-access (restricted) case indicator. */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5h9v7h-9zM5.5 7.5V5a2.5 2.5 0 015 0v2.5" />
    </Svg>
  );
}

/** Archive box: closed records state indicator. */
export function ArchiveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 2.5h13v3h-13zM2.5 5.5v8h11v-8M6 8.5h4" />
    </Svg>
  );
}

/** Open circle: active records state indicator. */
export function ActiveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5" />
    </Svg>
  );
}

/** Person: the persona menu button. */
export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="5" r="2.75" />
      <path d="M2.5 14.5c.5-3 2.75-4.5 5.5-4.5s5 1.5 5.5 4.5" />
    </Svg>
  );
}
