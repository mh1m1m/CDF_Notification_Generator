"use client";
// Disclosure menu for the TopBar (WorkspaceSwitcher, PersonaMenu). Built on <details>/<summary>, so it opens and
// closes without JavaScript; with JavaScript it adds the keyboard path of WORKSPACES.md §3: Escape closes and returns
// focus to the button, Arrow Up/Down move between the menu's buttons and links, and a click outside closes it.
// Choosing an item (a form submit or a link) closes it too: the TopBar survives a client-side navigation, so the
// menu must not stay open over the next page.
// The panel content is server-rendered and passed in as children.
import { useEffect, useRef, type ReactNode } from "react";

export interface DisclosureProps {
  /** Content of the button (the <summary>). */
  summary: ReactNode;
  /** Attributes for the button, e.g. its test id and data-workspace-code (ADR-013). */
  summaryProps?: Readonly<Record<`data-${string}`, string>>;
  /** Accessible name of the panel. */
  panelLabel: string;
  className?: string;
  /** Test id of the <details> element. */
  testId?: string;
  children: ReactNode;
}

const FOCUSABLE = "a[href], button:not([disabled])";

export function Disclosure({
  summary,
  summaryProps,
  panelLabel,
  className,
  testId,
  children,
}: DisclosureProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const summaryEl = details.querySelector("summary");

    const onKeyDown = (event: KeyboardEvent) => {
      if (!details.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        details.open = false;
        summaryEl?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(
        details.querySelectorAll<HTMLElement>(`[data-disclosure-panel] :is(${FOCUSABLE})`),
      );
      if (items.length === 0) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
      items[next]?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target))
        details.open = false;
    };

    const close = () => {
      details.open = false;
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-disclosure-panel] a[href]")) close();
    };

    details.addEventListener("keydown", onKeyDown);
    details.addEventListener("submit", close);
    details.addEventListener("click", onClick);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      details.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("submit", close);
      details.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <details
      ref={ref}
      className={className ? `v13-disclosure ${className}` : "v13-disclosure"}
      data-testid={testId}
    >
      <summary className="v13-disclosure-button" {...summaryProps}>
        {summary}
      </summary>
      <div className="v13-disclosure-panel" role="group" aria-label={panelLabel} data-disclosure-panel="">
        {children}
      </div>
    </details>
  );
}
