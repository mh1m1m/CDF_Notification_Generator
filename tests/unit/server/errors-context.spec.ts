// lib/server errors and request context: generic answers with correlation id, nothing caller-supplied leaks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, PUBLIC_ERROR_CODES, toUserError } from "@/lib/server/errors";
import { contextFromSession } from "@/lib/server/context";
import { CORRELATION, ctxFor, SECRETARY } from "./support/identities";

afterEach(() => vi.restoreAllMocks());

describe("toUserError", () => {
  it("keeps AppError codes and logs nothing for them", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const code of PUBLIC_ERROR_CODES) {
      expect(toUserError(new AppError(code), CORRELATION)).toEqual({ code, correlationId: CORRELATION });
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("turns anything else into UNAVAILABLE and logs only event, correlation id and code", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secretish = Object.assign(
      new Error('relation "cdf_notifications_v13.case_record" password=hunter2'),
      {
        code: "42501",
      },
    );
    const answer = toUserError(secretish, CORRELATION, "case_read");
    expect(answer).toEqual({ code: "UNAVAILABLE", correlationId: CORRELATION });
    expect(JSON.stringify(answer)).not.toMatch(/case_record|hunter2|42501/);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ event: "case_read", correlation_id: CORRELATION, code: "42501" });
    expect(line).not.toMatch(/case_record|hunter2/);
  });

  it("handles non-Error throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const thrown of [undefined, null, "text", 42, { message: "x" }]) {
      expect(toUserError(thrown, CORRELATION).code).toBe("UNAVAILABLE");
    }
  });

  it("AppError messages are the code only", () => {
    expect(new AppError("NOT_FOUND").message).toBe("NOT_FOUND");
  });
});

describe("contextFromSession", () => {
  it("refuses a missing session with UNAUTHENTICATED", () => {
    expect(() => contextFromSession(null, CORRELATION)).toThrow(AppError);
    try {
      contextFromSession(null, CORRELATION);
    } catch (e) {
      expect((e as AppError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("carries the session's identity and the correlation id", () => {
    const { session } = ctxFor(SECRETARY);
    const ctx = contextFromSession(session, CORRELATION);
    expect(ctx.identity).toBe(session.identity);
    expect(ctx.correlationId).toBe(CORRELATION);
  });
});
