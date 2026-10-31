"use client";
// Copy-to-clipboard for a correlation id: progressive. Without JavaScript (or without the Clipboard API) nothing is
// rendered and the id stays selectable text.
import { useEffect, useState } from "react";

export function CopyButton({ text, label, doneLabel }: { text: string; label: string; doneLabel: string }) {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    // Shown only once the Clipboard API is known to exist, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(typeof navigator !== "undefined" && Boolean(navigator.clipboard));
  }, []);
  if (!ready) return null;
  return (
    <button
      type="button"
      className="v13-btn v13-btn-text"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true));
      }}
    >
      <span aria-live="polite">{done ? doneLabel : label}</span>
    </button>
  );
}
