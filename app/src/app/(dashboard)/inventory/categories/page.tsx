"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CreateCategoryRequest, CreateCategoryResponse } from "@drezivo/contracts";
import { useApiClient, ApiError } from "@/lib/api-client";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

export default function ManageCategoriesPage() {
  const { organization } = useOrganization();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: categories, isPending, isError, error } = useQuery({
    queryKey: ["categories", organization?.id],
    queryFn: () => api.get<Category[]>("/catalogue/categories"),
    enabled: Boolean(organization),
  });

  const { submit, isPending: isCreating, error: createError, resetIntent } = useSubmitGuard(
    async (idempotencyKey: string) => {
      const body: CreateCategoryRequest = { name: name.trim() };
      return api.post<CreateCategoryResponse>("/catalogue/categories", body, idempotencyKey);
    }
  );

  async function handleCreate() {
    const result = await submit().catch(() => undefined);
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["categories"] });
    setName("");
    setDialogOpen(false);
  }

  function closeDialog() {
    resetIntent();
    setName("");
    setDialogOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Categories</h1>
          <p className="text-sm text-ink-500">
            Organize styles for your storefront&apos;s search and filters (PRD FR9). Hiding a category removes it
            from public results without deleting anything.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>New category</Button>
      </div>

      {isPending && <TableSkeleton columns={2} />}

      {isError && (
        <EmptyState
          heading="Couldn't load categories"
          description={error instanceof Error ? error.message : "Try refreshing the page."}
        />
      )}

      {categories && categories.length === 0 && (
        <EmptyState
          heading="No categories yet"
          description="Create a category like “Barongs” or “Gowns” so guests can filter your storefront by type."
          action={<Button onClick={() => setDialogOpen(true)}>New category</Button>}
        />
      )}

      {categories && categories.length > 0 && (
        <Table
          caption="Categories"
          rows={categories}
          getRowId={(category) => category.id}
          columns={[
            { key: "name", header: "Name", render: (category) => category.name },
            { key: "count", header: "Active assets", align: "right", render: (category) => category.activeAssetCount },
          ]}
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title="New category" description="Visible on your storefront once at least one active item is assigned to it.">
        <Input
          label="Category name"
          value={name}
          disabled={isCreating}
          onChange={(event) => {
            setName(event.target.value);
            resetIntent();
          }}
        />
        {createError && (
          <p role="alert" className="text-sm text-danger-500">
            {createError instanceof ApiError ? createError.message : "Something went wrong. Try again."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeDialog} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} isPending={isCreating} pendingLabel="Creating…" disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
