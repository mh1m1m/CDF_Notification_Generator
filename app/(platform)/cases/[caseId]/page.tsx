// Case Workspace, overview tab (FE-004, SCREENS S3). The route's case id is the only case context.
import type { Metadata } from "next";
import { caseTabMetadata, CaseTabPage, type CaseRouteProps } from "./_components/render";

export const dynamic = "force-dynamic";

export function generateMetadata(props: CaseRouteProps): Promise<Metadata> {
  return caseTabMetadata(props, "overview");
}

export default function Page(props: CaseRouteProps) {
  return <CaseTabPage {...props} tab="overview" />;
}
