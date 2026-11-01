"use client";
// Scenario E draft form (V13-FE-006). A client component only for useActionState: a refusal is shown in place with
// its reference, on the page the persona is on. It receives plain, already-localised strings and ids from the server
// component; it imports nothing from lib/server, lib/disclosure or lib/authority (DESIGN §12, unit-tested).
import { useActionState, useEffect, useRef, useState } from "react";
import { createDraft, type DraftActionState } from "../actions";
import styles from "../../_components/case.module.css";

export interface DraftFormText {
  readonly heading: string;
  readonly hint: string;
  readonly template: string;
  /** The label before the selected template's code, shown under the select (V13-FE-016). */
  readonly templateCode: string;
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
  // V13-FE-016 (UXB-19): a closed native select cannot wrap, so at 320 px in Arabic the start of a long template code
  // is cut. The selected template's code is repeated as text under the select, where it wraps. Without JavaScript it
  // shows the first template, which is the default selection.
  const templateRef = useRef<HTMLSelectElement>(null);
  const codeOf = (value: string | undefined) =>
    templates.find((o) => o.value === value)?.code ?? templates[0]?.code;
  const [selectedCode, setSelectedCode] = useState(() => codeOf(undefined));
  // A browser that restores the form (back / forward) restores the select without a change event.
  useEffect(() => {
    setSelectedCode(codeOf(templateRef.current?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after hydration
  }, []);
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
      <form
        action={action}
        // React resets the form after the action; the select returns to the first template.
        onReset={() => setSelectedCode(codeOf(undefined))}
        className={styles.form}
        data-testid="draft-form"
      >
        <input type="hidden" name="case_id" value={caseId} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <input type="hidden" name="case_binding" value={binding} />
        <label htmlFor="draft-template">{text.template}</label>
        <select
          ref={templateRef}
          id="draft-template"
          name="template_version_id"
          required
          aria-describedby={selectedCode ? "draft-template-code" : undefined}
          onChange={(e) => setSelectedCode(codeOf(e.currentTarget.value))}
          data-testid="draft-template"
        >
          {templates.map((o) => (
            <option key={o.value} value={o.value} data-template-code={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        {selectedCode ? (
          <p id="draft-template-code" className={styles.selectedCode} data-testid="draft-template-code">
            <span>{text.templateCode}</span>{" "}
            <bdi dir="ltr" data-testid="draft-template-code-value">
              {selectedCode}
            </bdi>
          </p>
        ) : null}
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
