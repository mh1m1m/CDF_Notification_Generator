"use client";
// Confirmation dialog: a native <dialog> opened with showModal(), so the platform traps focus and Escape cancels; focus
// returns to the button that opened it. The confirm button submits a form to a Server Action (with optional hidden
// fields). Needs JavaScript to open; pages offer it only for confirmations, never as the only route to information.
import { useRef, type ReactNode } from "react";
import { criticalClass } from "./Button";

export interface ConfirmDialogProps {
  /** Label of the button that opens the dialog. */
  triggerLabel: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  action: (formData: FormData) => Promise<void>;
  /** Hidden form fields sent with the confirmation (ids only). */
  fields?: Readonly<Record<string, string>>;
  /** Destructive confirmation: the confirm button uses the critical style. */
  critical?: boolean;
  testId?: string;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    triggerLabel,
    title,
    body,
    confirmLabel,
    cancelLabel,
    action,
    fields,
    critical,
    testId = "confirm-dialog",
  } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = `${testId}-title`;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="v13-btn v13-btn-secondary"
        data-testid={`${testId}-open`}
        onClick={() => dialog.current?.showModal()}
      >
        {triggerLabel}
      </button>
      <dialog
        ref={dialog}
        className="v13-dialog"
        aria-labelledby={titleId}
        data-testid={testId}
        onClose={() => trigger.current?.focus()}
      >
        <h2 id={titleId}>{title}</h2>
        <div>{body}</div>
        <form action={action} className="v13-dialog-actions">
          {Object.entries(fields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button
            type="submit"
            className={critical ? criticalClass() : "v13-btn v13-btn-primary"}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="v13-btn v13-btn-secondary"
            data-testid={`${testId}-cancel`}
            onClick={() => dialog.current?.close()}
          >
            {cancelLabel}
          </button>
        </form>
      </dialog>
    </>
  );
}
