import { ClothingDetailsPage } from "@/components/inventory/clothing-details-page";

export default async function ClothingDetailsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClothingDetailsPage productId={id} />;
}
