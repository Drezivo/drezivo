import { EditClothingPage } from "@/components/inventory/edit-clothing-page";

export default async function EditClothingRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditClothingPage productId={id} />;
}
