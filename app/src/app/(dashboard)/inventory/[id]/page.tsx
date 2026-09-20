import { notFound } from "next/navigation";

import { CLOTHING_ITEMS } from "@/components/inventory/clothing-data";
import { ClothingDetailsPage } from "@/components/inventory/clothing-details-page";

export default async function ClothingDetailsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = CLOTHING_ITEMS.find((clothing) => clothing.id === id);
  if (!item) notFound();

  return <ClothingDetailsPage item={item} />;
}
