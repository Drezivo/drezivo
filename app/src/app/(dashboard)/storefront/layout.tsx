import { StorefrontEditorProvider } from "@/components/storefront/storefront-editor";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return <StorefrontEditorProvider>{children}</StorefrontEditorProvider>;
}
