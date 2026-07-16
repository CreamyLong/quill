import { WorkProviders } from "./providers";

export default function WorkThreadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkProviders>{children}</WorkProviders>;
}
