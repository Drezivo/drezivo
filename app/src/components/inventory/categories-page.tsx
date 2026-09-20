"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, RefreshCw, Tags } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CatalogueCategory } from "@drezivo/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export function CategoriesPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

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

  function handleUpdated(updated: CatalogueCategory) {
    setState((current) => {
      if (current.kind !== "ready") return current;
      return {
        kind: "ready",
        categories: current.categories.map((category) =>
          category.id === updated.id ? updated : category
        ),
      };
    });
  }

  return (
    <div className="min-h-full bg-dashboard-canvas px-4 py-6 sm:px-6 lg:px-8">
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
              <h1 className="font-display text-3xl font-semibold tracking-tight text-dashboard-navy sm:text-4xl">
                Categories
              </h1>
              <p className="mt-1 text-sm text-dashboard-muted">
                Choose which clothing categories are shown on your public storefront.
              </p>
            </div>
          </div>
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
        </div>

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
                    <p className="mt-1 text-xs text-dashboard-muted">
                      Support reference: {state.error.requestId}
                    </p>
                  ) : null}
                </div>
                <Button type="button" onClick={() => void loadCategories()}>
                  Try again
                </Button>
              </div>
            ) : null}
            {state.kind === "ready" ? (
              state.categories.length === 0 ? (
                <div className="flex min-h-60 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                  <Tags className="h-7 w-7 text-dashboard-muted" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-dashboard-navy">No categories yet</p>
                    <p className="mt-1 text-sm text-dashboard-muted">
                      This workspace does not have any clothing categories.
                    </p>
                  </div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-dashboard-surface hover:bg-dashboard-surface">
                      <TableHead>Category</TableHead>
                      <TableHead className="w-28">Order</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-40 text-right">Storefront</TableHead>
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
                        <TableCell className="text-right">
                          <CategoryStatusButton
                            category={category}
                            getToken={getToken}
                            onUpdated={handleUpdated}
                          />
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
    </div>
  );
}

function CategoryStatusButton({
  category,
  getToken,
  onUpdated,
}: {
  category: CatalogueCategory;
  getToken: () => Promise<string | null>;
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
        createDrezivoApiClient(getToken).updateCatalogueCategoryStatus(
          category.id,
          { status: nextStatus },
          idempotencyKey
        )
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
        {isSubmitting
          ? "Saving…"
          : category.status === "active"
            ? "Set inactive"
            : "Set active"}
      </Button>
      {error ? (
        <span role="alert" className="max-w-48 text-right text-xs text-dashboard-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="flex min-h-60 items-center justify-center px-6 py-12 text-sm text-dashboard-muted">
      Loading categories…
    </div>
  );
}

function toDrezivoApiError(error: unknown): DrezivoApiError {
  if (error instanceof DrezivoApiError) return error;
  return new DrezivoApiError("We could not complete that request. Please try again.", {
    status: 500,
  });
}
