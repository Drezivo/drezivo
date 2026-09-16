"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CreateClothingItemRequest, CreateClothingItemResponse } from "@drezivo/contracts";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AddClothingItemPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: categories } = useQuery({
    queryKey: ["categories", organization?.id],
    queryFn: () => api.get<Category[]>("/catalogue/categories"),
    enabled: Boolean(organization),
  });

  const [form, setForm] = useState({
    styleName: "",
    categoryId: "",
    variantLabel: "",
    assetCode: "",
    rentalAmount: "",
    depositAmount: "",
  });

  const { submit, isPending, error, resetIntent } = useSubmitGuard(async (idempotencyKey: string) => {
    const body: CreateClothingItemRequest = form;
    // Server recomputes/validates pricing and rejects an unknown category (TRD §4 "reject
    // unknown enum values"); this client never assumes the write succeeded before the
    // response confirms it.
    return api.post<CreateClothingItemResponse>("/catalogue/assets", body, idempotencyKey);
  });

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // Editing the form after a failed submit is a new intent — mint a fresh idempotency
    // key so a corrected retry is never treated as a duplicate of the abandoned attempt.
    resetIntent();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = await submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    router.push(`/inventory/${result.assetId}`);
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Add clothing item</h1>
        <p className="text-sm text-ink-500">
          Creates a style, one variant, and one physical asset in a single step. You can add more variants and
          assets to this style afterward.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-ink-300 bg-white p-6">
        <Input
          label="Style name"
          required
          disabled={isPending}
          value={form.styleName}
          onChange={(event) => updateField("styleName", event.target.value)}
        />

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-700">Category</span>
          <select
            required
            disabled={isPending}
            value={form.categoryId}
            onChange={(event) => updateField("categoryId", event.target.value)}
            className="rounded-md border border-ink-300 px-3 py-2 text-sm disabled:bg-ink-100"
          >
            <option value="" disabled>
              Select a category
            </option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <Input
          label="Variant (size / color)"
          required
          disabled={isPending}
          placeholder="e.g. Medium — Navy"
          value={form.variantLabel}
          onChange={(event) => updateField("variantLabel", event.target.value)}
        />

        <Input
          label="Asset code"
          required
          disabled={isPending}
          hint="A unique code you'll use to identify this physical item at pickup/return."
          value={form.assetCode}
          onChange={(event) => updateField("assetCode", event.target.value)}
        />

        <Input
          label="Rental price (PHP)"
          required
          disabled={isPending}
          inputMode="decimal"
          placeholder="1500.00"
          value={form.rentalAmount}
          onChange={(event) => updateField("rentalAmount", event.target.value)}
        />

        <Input
          label="Security deposit (PHP)"
          required
          disabled={isPending}
          inputMode="decimal"
          placeholder="2000.00"
          value={form.depositAmount}
          onChange={(event) => updateField("depositAmount", event.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-danger-500">
            {error instanceof ApiError
              ? `${error.message}${error.fields ? ` — ${Object.entries(error.fields).map(([field, msgs]) => `${field}: ${msgs.join(", ")}`).join("; ")}` : ""}`
              : "Something went wrong. Try again."}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push("/inventory")} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" isPending={isPending} pendingLabel="Saving…">
            Save item
          </Button>
        </div>
      </form>
    </div>
  );
}
