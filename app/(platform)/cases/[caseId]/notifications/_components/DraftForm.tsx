"use client";
// Scenario E draft form (V13-FE-006). A client component only for useActionState: a refusal is shown in place with
// its reference, on the page the persona is on. It receives plain, already-localised strings and ids from the server
// component; it imports nothing from lib/server, lib/disclosure or lib/authority (DESIGN §12, unit-tested).
import { useActionState, useEffect, useRef } from "react";
import { createDraft, type DraftActionState } from "../actions";
import styles from "../../_components/case.module.css";

export interface DraftFormText {
  readonly heading: string;
  readonly hint: string;
  readonly template: string;
  readonly recipient: string;
  readonly submit: string;
  readonly error: string;
  readonly correlation: string;
}

export interface DraftFormProps {
  readonly caseId: string;
  readonly idempotencyKey: string;
  /** The server's binding of caseId and idempotencyKey (V13-FE-012); opaque here. */
  readonly binding: string;
  readonly templates: readonly { readonly value: string; readonly code: string; readonly label: string }[];
  readonly recipients: readonly { readonly value: string; readonly label: string }[];
  readonly text: DraftFormText;
}

export function DraftForm({ caseId, idempotencyKey, binding, templates, recipients, text }: DraftFormProps) {
  const [state, action, pending] = useActionState<DraftActionState, FormData>(createDraft, null);
  // After a refusal, focus moves to the alert: the submit button was disabled while pending, so focus would otherwise
  // fall to <body> and keyboard users would lose their place (QA review of #51).
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state) errorRef.current?.focus();
  }, [state]);
  return (
    <section aria-labelledby="draft-heading" data-testid="draft-section">
      <h2 id="draft-heading">{text.heading}</h2>
      <p className={styles.meta}>{text.hint}</p>
      {state ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="v13-error" data-testid="draft-error">
          <p>{text.error}</p>
          <p>
            <span>{text.correlation}</span>{" "}
            <bdi dir="ltr" data-testid="correlation-id">
              {state.reference}
            </bdi>
          </p>
        </div>
      ) : null}
      <form action={action} className={styles.form} data-testid="draft-form">
        <input type="hidden" name="case_id" value={caseId} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <input type="hidden" name="case_binding" value={binding} />
        <label htmlFor="draft-template">{text.template}</label>
        <select id="draft-template" name="template_version_id" required data-testid="draft-template">
          {templates.map((o) => (
            <option key={o.value} value={o.value} data-template-code={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        <label htmlFor="draft-recipient">{text.recipient}</label>
        <select id="draft-recipient" name="recipient_class" required data-testid="draft-recipient">
          {recipients.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} aria-disabled={pending} data-testid="draft-submit">
          {text.submit}
        </button>
      </form>
    </section>
  );
}
