// CaseWorkspace: the root that wraps all /cases/[caseId]/* content (CaseHeader, case tabs, tab body and the
// notification preview). It carries the case it belongs to (ADR-013): data-case-id (UUID) and data-case-ref (display
// number). QA's Case Context Sentinel asserts that nothing inside it belongs to another case. The case comes from the
// URL only; there is no "current case" state anywhere (INFORMATION_ARCHITECTURE.md §5).
import type { ReactNode } from "react";
import { assertCaseIdentity } from "./case-identity";

export interface CaseWorkspaceProps {
  caseId: string;
  caseRef: string;
  children: ReactNode;
}

export function CaseWorkspace({ caseId, caseRef, children }: CaseWorkspaceProps) {
  assertCaseIdentity(caseId, caseRef);
  return (
    <div
      className="v13-case-workspace"
      data-testid="case-workspace"
      data-case-id={caseId}
      data-case-ref={caseRef}
    >
      {children}
    </div>
  );
}
