"use client";

import { useAuth } from "@clerk/nextjs";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Pencil, Plus, RefreshCw, Tags, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CatalogueCategory } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: DrezivoApiError }
  | { kind: "ready"; categories: CatalogueCategory[] };

type TokenGetter = () => Promise<string | null>;

export function CategoriesPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [formCategory, setFormCategory] = useState<CatalogueCategory | "new" | null>(null);
  const [removeCategory, setRemoveCategory] = useState<CatalogueCategory | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    setState({ kind: "loading" });
    try {
      const result = await createDrezivoApiClient(getToken).getCatalogueCategories();
      setState({ kind: "ready", categories: result.data.items });
    } catch (error) {
      setState({ kind: "error", error: toDrezivoApiError(error) });
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function upsertCategory(updated: CatalogueCategory) {
    setState((current) => {
      if (current.kind !== "ready") return current;
      const exists = current.categories.some((category) => category.id === updated.id);
      const categories = exists
        ? current.categories.map((category) => (category.id === updated.id ? updated : category))
        : [...current.categories, updated];
      categories.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
      return { kind: "ready", categories };
    });
  }

  function handleRemoved(categoryId: string, outcome: "deleted" | "deactivated") {
    setState((current) => {
      if (current.kind !== "ready") return current;
      if (outcome === "deleted") {
        return {
          kind: "ready",
          categories: current.categories.filter((category) => category.id !== categoryId),
        };
      }
      return {
        kind: "ready",
        categories: current.categories.map((category) =>
          category.id === categoryId ? { ...category, status: "inactive" } : category
        ),
      };
    });
  }

  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter py-6">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/inventory"
              aria-label="Back to Clothing"
              className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashboard-border bg-dashboard-surface text-dashboard-navy transition-colors hover:bg-dashboard-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="dashboard-page-title">
                Categories
              </h1>
              <p className="mt-1 text-sm text-dashboard-muted">
                Organize clothing categories and control which ones remain available for new catalogue work.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void loadCategories()}
              disabled={!isLoaded || !isSignedIn || state.kind === "loading"}
              className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button type="button" onClick={() => setFormCategory("new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Category
            </Button>
          </div>
        </div>

        {notice ? (
          <div role="status" className="rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 text-sm text-dashboard-navy">
            {notice}
          </div>
        ) : null}

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            {state.kind === "loading" ? <LoadingRows /> : null}
            {state.kind === "error" ? (
              <div className="flex min-h-60 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-dashboard-active text-dashboard-accent">
                  <Tags className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-dashboard-navy">Could not load categories</p>
                  <p className="mt-1 max-w-md text-sm text-dashboard-muted">{state.error.message}</p>
                  {state.error.requestId ? (
                    <p className="mt-1 text-xs text-dashboard-muted">Support reference: {state.error.requestId}</p>
                  ) : null}
                </div>
                <Button type="button" onClick={() => void loadCategories()}>Try again</Button>
              </div>
            ) : null}
            {state.kind === "ready" ? (
              state.categories.length === 0 ? (
                <div className="flex min-h-60 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                  <Tags className="h-7 w-7 text-dashboard-muted" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-dashboard-navy">No categories yet</p>
                    <p className="mt-1 text-sm text-dashboard-muted">Add the first category for this workspace.</p>
                  </div>
                  <Button type="button" onClick={() => setFormCategory("new")}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add Category
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
                      <TableHead>Category</TableHead>
                      <TableHead className="w-28">Order</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-[300px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.categories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dashboard-active text-dashboard-accent">
                              <Tags className="h-4 w-4" aria-hidden="true" />
                            </div>
                            <span className="font-medium text-dashboard-navy">{category.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-dashboard-muted">{category.display_order}</TableCell>
                        <TableCell>
                          <Badge variant={category.status === "active" ? "secondary" : "outline"}>
                            {category.status === "active" ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <CategoryStatusButton category={category} getToken={getToken} onUpdated={upsertCategory} />
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Edit ${category.name}`}
                              onClick={() => setFormCategory(category)}
                              className="border border-dashboard-border"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`Remove ${category.name}`}
                              onClick={() => setRemoveCategory(category)}
                              className="border border-dashboard-border text-dashboard-danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Remove
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>

      <CategoryFormDialog
        category={formCategory}
        getToken={getToken}
        onOpenChange={(open) => {
          if (!open) setFormCategory(null);
        }}
        onSaved={(category, created) => {
          upsertCategory(category);
          setFormCategory(null);
          setNotice(created ? `Category “${category.name}” added.` : `Category “${category.name}” updated.`);
        }}
      />
      <RemoveCategoryDialog
        category={removeCategory}
        getToken={getToken}
        onOpenChange={(open) => {
          if (!open) setRemoveCategory(null);
        }}
        onRemoved={(categoryId, outcome) => {
          handleRemoved(categoryId, outcome);
          setRemoveCategory(null);
          setNotice(outcome === "deleted" ? "Category removed." : "Category is in use, so it was set inactive and retained for history.");
        }}
      />
    </div>
  );
}

function CategoryFormDialog({
  category,
  getToken,
  onOpenChange,
  onSaved,
}: {
  category: CatalogueCategory | "new" | null;
  getToken: TokenGetter;
  onOpenChange: (open: boolean) => void;
  onSaved: (category: CatalogueCategory, created: boolean) => void;
}) {
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [name, setName] = useState("");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const open = category !== null;
  const isCreate = category === "new";
  const existingCategoryId = category !== null && category !== "new" ? category.id : null;

  useEffect(() => {
    if (!open) return;
    setName(isCreate ? "" : category.name);
    setDisplayOrder(isCreate ? "0" : String(category.display_order));
    setError(null);
    resetIntent();
  }, [category, isCreate, open, resetIntent]);

  async function save() {
    if (isSubmitting) return;
    const normalizedName = name.trim();
    const order = Number(displayOrder);
    if (!normalizedName) {
      setError("Enter a category name.");
      return;
    }
    if (!Number.isInteger(order) || order < 0) {
      setError("Display order must be a non-negative whole number.");
      return;
    }
    setError(null);
    try {
      const result = await submit((idempotencyKey) =>
        isCreate
          ? createDrezivoApiClient(getToken).createCatalogueCategory(
              { name: normalizedName, display_order: order },
              idempotencyKey
            )
          : createDrezivoApiClient(getToken).updateCatalogueCategory(
              existingCategoryId ?? "",
              { name: normalizedName, display_order: order },
              idempotencyKey
            )
      );
      if (!result) return;
      onSaved(result.data, isCreate);
      resetIntent();
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError).message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
                {isCreate ? "Add category" : "Edit category"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-dashboard-muted">
                Categories organize Clothing filters and storefront browsing.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close category dialog">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-dashboard-navy">
              Category name
              <Input className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
            </label>
            <label className="block text-sm font-medium text-dashboard-navy">
              Display order
              <Input className="mt-1.5" type="number" min={0} step={1} value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} />
            </label>
            {error ? <p role="alert" className="text-sm text-dashboard-danger">{error}</p> : null}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="secondary" disabled={isSubmitting}>Cancel</Button></Dialog.Close>
            <Button type="button" disabled={isSubmitting} onClick={() => void save()}>
              {isSubmitting ? "Saving…" : isCreate ? "Add Category" : "Save Changes"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveCategoryDialog({
  category,
  getToken,
  onOpenChange,
  onRemoved,
}: {
  category: CatalogueCategory | null;
  getToken: TokenGetter;
  onOpenChange: (open: boolean) => void;
  onRemoved: (categoryId: string, outcome: "deleted" | "deactivated") => void;
}) {
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!category) return;
    setError(null);
    resetIntent();
  }, [category, resetIntent]);

  async function remove() {
    if (!category || isSubmitting) return;
    setError(null);
    try {
      const result = await submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).removeCatalogueCategory(category.id, idempotencyKey)
      );
      if (!result) return;
      onRemoved(result.data.category_id, result.data.outcome);
      resetIntent();
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError).message);
    }
  }

  return (
    <Dialog.Root open={category !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Remove category?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-dashboard-muted">
            {category ? `Remove “${category.name}” from active category management?` : "Remove this category?"} If clothing already references it, Drezivo will keep it for history and set it inactive instead of deleting it.
          </Dialog.Description>
          {error ? <p role="alert" className="mt-4 text-sm text-dashboard-danger">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="secondary" disabled={isSubmitting}>Cancel</Button></Dialog.Close>
            <Button type="button" variant="danger" disabled={isSubmitting} onClick={() => void remove()}>
              {isSubmitting ? "Removing…" : "Remove Category"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoryStatusButton({ category, getToken, onUpdated }: {
  category: CatalogueCategory;
  getToken: TokenGetter;
  onUpdated: (category: CatalogueCategory) => void;
}) {
  const { isSubmitting, resetIntent, submit } = useSubmitGuard();
  const [error, setError] = useState<string | null>(null);
  const nextStatus = category.status === "active" ? "inactive" : "active";

  async function handleToggle() {
    if (isSubmitting) return;
    setError(null);
    try {
      const result = await submit((idempotencyKey) =>
        createDrezivoApiClient(getToken).updateCatalogueCategoryStatus(category.id, { status: nextStatus }, idempotencyKey)
      );
      if (!result) return;
      onUpdated(result.data);
      resetIntent();
    } catch (caughtError) {
      setError(toDrezivoApiError(caughtError).message);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        disabled={isSubmitting}
        aria-label={`${nextStatus === "active" ? "Show" : "Hide"} ${category.name} on storefront`}
        onClick={() => void handleToggle()}
        className="border border-dashboard-border bg-dashboard-surface text-dashboard-navy hover:bg-dashboard-active"
      >
        {isSubmitting ? "Saving…" : category.status === "active" ? "Set inactive" : "Set active"}
      </Button>
      {error ? <span role="alert" className="max-w-48 text-right text-xs text-dashboard-danger">{error}</span> : null}
    </div>
  );
}

function LoadingRows() {
  return <div className="flex min-h-60 items-center justify-center px-6 py-12 text-sm text-dashboard-muted">Loading categories…</div>;
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not complete that request. Please try again.", { status: 500 });
}
