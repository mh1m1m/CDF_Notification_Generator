// NotificationPreviewFrame (V13-UX-006; FE DESIGN §12–13, REQ-NOTIF-011). Shows a notification preview that the
// server has already rendered from a Projected<T> model (lib/notifications/render: renderEmail or renderPlatform) in
// an isolated frame:
//   - <iframe srcdoc> with an empty sandbox attribute: no scripts, no same-origin, no forms, no popups, no top
//     navigation. Never a src URL, never dangerouslySetInnerHTML or any other injection into the page.
//   - The srcdoc document inherits the page's Content-Security-Policy (lib/http/csp.ts). The renderer's inline
//     <style> works under style-src 'unsafe-inline'; nothing can run.
//   - A server component: the HTML goes to the browser as an escaped attribute and never into a client bundle.
// Runtime guard, for callers outside the type system: anything that is not a complete document carrying the
// renderer's DESIGN_PREVIEW marking renders nothing and logs a warning without content.
import type { RenderedEmail } from "@/lib/notifications/render/email";
import type { RenderedPlatform } from "@/lib/notifications/render/platform";
import type { Locale, Translator } from "@/lib/i18n";

/** A preview the renderer produced from a projected model. Only its `html` is used. */
export type RenderedPreview = Pick<RenderedEmail, "html"> | Pick<RenderedPlatform, "html">;

export interface NotificationPreviewFrameProps {
  t: Translator;
  rendered: RenderedPreview;
  /** Accessible name of the frame, localised by the caller (e.g. the notice's subject). */
  title: string;
  /** Language of the rendered document; sets lang and dir on the frame. */
  lang: Locale;
  testId?: string;
}

const DOCTYPE = /^<!DOCTYPE html>/i;
const MARKING = 'data-marking="DESIGN_PREVIEW"';

function refuse(reason: string): null {
  console.warn(`NotificationPreviewFrame refused: ${reason}`);
  return null;
}

export function NotificationPreviewFrame({
  t,
  rendered,
  title,
  lang,
  testId = "notification-preview",
}: NotificationPreviewFrameProps) {
  const html = rendered?.html;
  if (typeof html !== "string" || !DOCTYPE.test(html)) return refuse("not a rendered document");
  if (!html.includes(MARKING)) return refuse("missing the DESIGN_PREVIEW marking");
  if (title.trim() === "") return refuse("missing title");
  return (
    <figure className="v13-preview" data-testid={testId}>
      <iframe
        className="v13-preview-frame"
        srcDoc={html}
        sandbox=""
        title={title}
        lang={lang}
        dir={lang === "ar" ? "rtl" : "ltr"}
        referrerPolicy="no-referrer"
        data-testid={`${testId}-frame`}
      />
      <figcaption className="v13-preview-caption v13-muted">{t("common.preview.caption")}</figcaption>
    </figure>
  );
}
