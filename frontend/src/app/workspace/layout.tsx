import { WorkspaceContent } from "./workspace-content";

export const dynamic = "force-dynamic";

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceContent>{children}</WorkspaceContent>;
}
