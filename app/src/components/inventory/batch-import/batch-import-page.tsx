"use client";

import { useAuth } from "@clerk/nextjs";
import type { CatalogueImportCapabilities, ExtractedClothingFields, MeasurementGuide } from "@drezivo/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  ImagePlus,
  Loader2,
  Plus,
  ScanText,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DrezivoApiError, createDrezivoApiClient } from "@/lib/drezivo-api";
import { cn } from "@/lib/utils";

import { clearBatch, loadBatch, saveBatch, type SavedBatch } from "./draft-store";
import {
  DEFAULT_IMPORT_DEFAULTS,
  MEASUREMENT_FIELDS,
  applyExtraction,
  editedRow,
  emptyRow,
  rowProblems,
  rowsFromPhotos,
  type ImportDefaults,
  type ImportRow,
} from "./import-model";
import { createRows, ensureCategories, readPhotos, uploadPhotos } from "./import-runner";
import { LeaveGuard } from "./leave-guard";
import { readSpreadsheet, rowsFromSheet, templateCsv } from "./spreadsheet";

type Phase = "idle" | "uploading" | "reading" | "saving";
type Category = { id: string; name: string };
type Notice = { tone: "success" | "error" | "info"; text: string };

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  uploading: "Uploading photos…",
  reading: "Reading details from photos…",
  saving: "Adding to your clothing…",
};

export function BatchImportPage() {
  const { getToken, orgId } = useAuth();
  const api = useMemo(() => createDrezivoApiClient(getToken), [getToken]);
  const workspaceKey = orgId ?? "personal";

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [defaults, setDefaults] = useState<ImportDefaults>(DEFAULT_IMPORT_DEFAULTS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaultGuide, setDefaultGuide] = useState<MeasurementGuide | null>(null);
  const [guideLoading, setGuideLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<CatalogueImportCapabilities | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savedDraft, setSavedDraft] = useState<SavedBatch | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publish, setPublish] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const busy = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.getCatalogueCategories().then(
      (result) => setCategories(result.data.items.filter((category) => category.status === "active").map(({ id, name }) => ({ id, name }))),
      () => setNotice({ tone: "error", text: "Categories could not be loaded. Refresh to try again." })
    );
    void api.getCatalogueImportCapabilities().then(
      (result) => setCapabilities(result.data),
      () => setCapabilities({ photo_extraction: false, max_batch_items: 25 })
    );
    void api.getDefaultMeasurementGuide().then(
      (result) => setDefaultGuide(result.data.guide),
      () => setDefaultGuide(null)
    ).finally(() => setGuideLoading(false));
  }, [api]);

  useEffect(() => {
    void loadBatch(workspaceKey).then((batch) => setSavedDraft(batch && batch.rows.length > 0 ? batch : null), () => undefined);
  }, [workspaceKey]);

  const pendingRows = rows.filter((row) => row.status !== "created");
  const problems = useMemo(
    () => new Map(rows.map((row) => [row.id, rowProblems(row, defaults, defaultGuide?.id ?? null)])),
    [rows, defaults, defaultGuide]
  );
  const readyRows = pendingRows.filter((row) => (problems.get(row.id) ?? []).length === 0);
  const unreadRows = rows.filter((row) => row.photo && !row.read && row.status !== "created");

  const updateRow = useCallback((id: string, patch: Partial<ImportRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const editRow = (id: string, patch: Partial<ImportRow>) => {
    setDirty(true);
    setRows((current) => current.map((row) => (row.id === id ? editedRow(row, patch) : row)));
  };

  const addRows = (next: ImportRow[], skipped: string[] = []) => {
    if (next.length > 0) setDirty(true);
    setRows((current) => [...current, ...next]);
    setNotice(
      skipped.length > 0
        ? { tone: "info", text: `${skipped.length} file${skipped.length === 1 ? " was" : "s were"} skipped (only JPEG, PNG or WebP photos up to 10 MB).` }
        : next.length > 0
          ? { tone: "info", text: `${next.length} item${next.length === 1 ? "" : "s"} added below. Fill in or check each row, then add them to your clothing.` }
          : null
    );
  };

  const onPhotos = (files: FileList | null) => {
    if (!files) return;
    const { rows: next, skipped } = rowsFromPhotos(Array.from(files), defaults);
    addRows(next, skipped);
  };

  const onSheet = async (file: File | undefined) => {
    if (!file) return;
    try {
      const table = await readSpreadsheet(file);
      // Photos already added without details are matched to sheet rows by file name.
      const loosePhotos = rows.filter((row) => row.photo && !row.name.trim()).map((row) => row.photo as File);
      const { rows: next, unmatchedPhotos, ignoredColumns } = rowsFromSheet(table, loosePhotos, defaults);
      const matched = new Set(next.flatMap((row) => (row.photo ? [row.photo] : [])));
      setRows((current) => current.filter((row) => !(row.photo && matched.has(row.photo))));
      addRows(next);
      const notes = [
        unmatchedPhotos.length > 0 ? `${unmatchedPhotos.length} photo name${unmatchedPhotos.length === 1 ? "" : "s"} in the sheet did not match an added photo` : null,
        ignoredColumns.length > 0 ? `columns ignored: ${ignoredColumns.join(", ")}` : null,
      ].filter(Boolean);
      if (notes.length > 0) setNotice({ tone: "info", text: `${next.length} rows imported; ${notes.join("; ")}.` });
    } catch {
      setNotice({ tone: "error", text: "That spreadsheet could not be read. Save it as .xlsx or .csv and try again." });
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "drezivo-clothing-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  /** Runs one long step at a time; a second click while one runs does nothing. */
  const runPhase = async (next: Exclude<Phase, "idle">, work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPhase(next);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof DrezivoApiError || error instanceof Error ? error.message : "Something went wrong. Your rows are still here; try again.",
      });
      // Rows caught mid-step go back to editable, keeping their keys so a retry replays.
      setRows((current) => current.map((row) => (["uploading", "reading", "saving"].includes(row.status) ? { ...row, status: "draft" } : row)));
    } finally {
      busy.current = false;
      setPhase("idle");
      setProgress(null);
    }
  };

  const readDetails = () =>
    runPhase("reading", async () => {
      const targets = rows.filter((row) => row.photo && !row.read && row.status !== "created");
      const uploaded = await uploadPhotos(api, targets, updateRow);
      const readable = targets.flatMap((row) => {
        const fileId = row.fileId ?? uploaded.get(row.id);
        return fileId ? [{ ...row, fileId }] : [];
      });
      let done = 0;
      setProgress({ done, total: readable.length });
      readable.forEach((row) => updateRow(row.id, { status: "reading" }));
      await readPhotos(
        api,
        readable.map((row) => ({ id: row.id, fileId: row.fileId })),
        (id, fields: ExtractedClothingFields | null, message) => {
          done += 1;
          setProgress({ done, total: readable.length });
          setRows((current) =>
            current.map((row) =>
              row.id !== id ? row : fields ? { ...applyExtraction(row, fields), status: "draft" } : { ...row, read: true, status: "draft", message }
            )
          );
        }
      );
      setDirty(true);
      setNotice({ tone: "info", text: "Details filled in from the photos. Check each row before adding: names and prices are suggestions." });
    });

  const addToClothing = () =>
    runPhase("saving", async () => {
      setConfirmOpen(false);
      const targets = readyRows;
      const pendingBefore = pendingRows.length;
      const categoryIds = await ensureCategories(api, targets.map((row) => row.category), categories);
      const uploaded = await uploadPhotos(api, targets, updateRow);
      // A row whose photo did not upload stays here marked; the rest go ahead with their file ids.
      const creatable = targets.flatMap((row) => {
        const fileId = row.fileId ?? uploaded.get(row.id) ?? null;
        return row.photo && !fileId ? [] : [{ ...row, fileId }];
      });
      const created = await createRows(api, creatable, defaults, categoryIds, defaultGuide?.id ?? null, publish, updateRow);
      const refreshed = await api.getCatalogueCategories().catch(() => null);
      if (refreshed) setCategories(refreshed.data.items.filter((category) => category.status === "active").map(({ id, name }) => ({ id, name })));
      setAddedCount((count) => count + created);
      setRows((rowsNow) => rowsNow.filter((row) => row.status !== "created"));
      const left = pendingBefore - created;
      setNotice({
        tone: created > 0 ? "success" : "error",
        text:
          created > 0
            ? `${created} added to your clothing${publish ? "" : " as drafts"}.${left > 0 ? ` ${left} still need attention below.` : ""}`
            : "Nothing was added. Check the rows marked in red.",
      });
      if (left === 0) {
        setDirty(false);
        await clearBatch(workspaceKey).catch(() => undefined);
      }
    });

  const saveForLater = async (): Promise<boolean> => {
    try {
      await saveBatch(workspaceKey, defaults, rows);
      setDirty(false);
      setNotice({ tone: "success", text: "Saved on this device. Open Batch add again to continue." });
      return true;
    } catch {
      setNotice({ tone: "error", text: "This browser could not save the batch. Keep the page open to finish it." });
      return false;
    }
  };

  const restoreDraft = () => {
    if (!savedDraft) return;
    setRows(savedDraft.rows);
    setDefaults(savedDraft.defaults);
    setSavedDraft(null);
    setDirty(false);
  };

  const discardDraft = () => {
    setSavedDraft(null);
    void clearBatch(workspaceKey).catch(() => undefined);
  };

  const removeRow = (id: string) => {
    setDirty(true);
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const applyToAll = (patch: Partial<ImportRow>, onlyEmpty: keyof ImportRow) => {
    setDirty(true);
    setRows((current) =>
      current.map((row) => (row.status === "created" || String(row[onlyEmpty] ?? "").trim() !== "" ? row : editedRow(row, patch)))
    );
  };

  const working = phase !== "idle";
  const categoryNames = categories.map((category) => category.name);

  return (
    <div className="min-h-full bg-dashboard-canvas px-ws-gutter pt-6">
      <LeaveGuard active={dirty && pendingRows.length > 0} pendingCount={pendingRows.length} onSaveForLater={saveForLater} />
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="dashboard-page-title">Batch add clothing</h1>
            <p className="mt-1 max-w-2xl text-sm text-dashboard-muted">
              Add many pieces at once: drop your photos or a spreadsheet, check each row, then add them all in one go.
              Everything is added as a draft so nothing shows on your storefront until you publish it.
            </p>
          </div>
        </div>

        {savedDraft ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashboard-border bg-dashboard-surface px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-dashboard-navy">
              You saved a batch of {savedDraft.rows.length} item{savedDraft.rows.length === 1 ? "" : "s"} on{" "}
              {new Date(savedDraft.savedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={discardDraft}>
                Discard it
              </Button>
              <Button type="button" size="sm" onClick={restoreDraft}>
                Continue it
              </Button>
            </div>
          </div>
        ) : null}

        <section aria-label="Add items" className="rounded-xl border border-dashboard-border bg-dashboard-surface p-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button type="button" disabled={working} onClick={() => photoInput.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden="true" /> Add photos
            </Button>
            <Button type="button" variant="secondary" disabled={working} onClick={() => folderInput.current?.click()}>
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Add a folder
            </Button>
            <Button type="button" variant="secondary" disabled={working} onClick={() => sheetInput.current?.click()}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Import spreadsheet
            </Button>
            <Button type="button" variant="secondary" disabled={working} onClick={() => addRows([emptyRow(defaults)])}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add a row
            </Button>
            <Button type="button" variant="ghost" onClick={downloadTemplate} className="col-span-2 sm:col-span-1">
              <Download className="h-4 w-4" aria-hidden="true" /> Spreadsheet template
            </Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-dashboard-muted">
            A folder&apos;s subfolders become categories (for example &ldquo;Wedding Gowns&rdquo;). In a spreadsheet, put each photo&apos;s file
            name in the &ldquo;Photo file&rdquo; column to link it to its row.
          </p>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { onPhotos(event.target.files); event.target.value = ""; }} />
          <input
            ref={(node) => {
              folderInput.current = node;
              node?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              onPhotos(event.target.files);
              event.target.value = "";
            }}
          />
          <input ref={sheetInput} type="file" accept=".csv,.xlsx,text/csv" hidden onChange={(event) => { void onSheet(event.target.files?.[0]); event.target.value = ""; }} />
        </section>

        {rows.length > 0 ? (
          <DefaultsPanel
            defaults={defaults}
            disabled={working}
            categoryNames={categoryNames}
            onChange={(patch) => {
              setDirty(true);
              setDefaults((current) => ({ ...current, ...patch }));
            }}
            onApplyCategory={(category) => applyToAll({ category }, "category")}
          />
        ) : null}

        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              notice.tone === "success" && "border-success-500/30 bg-success-500/10 text-success-500",
              notice.tone === "error" && "border-dashboard-danger/30 bg-dashboard-danger/10 text-dashboard-danger",
              notice.tone === "info" && "border-dashboard-border bg-dashboard-surface text-dashboard-navy"
            )}
          >
            {notice.text}
            {addedCount > 0 && notice.tone === "success" ? (
              <>
                {" "}
                <Link href="/inventory" className="font-medium underline underline-offset-2">
                  Review them in Clothing
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-dashboard-muted">
              {rows.length} item{rows.length === 1 ? "" : "s"} · {readyRows.length} ready ·{" "}
              {pendingRows.length - readyRows.length} need details
            </p>
            {capabilities?.photo_extraction && unreadRows.length > 0 ? (
              <Button type="button" variant="secondary" disabled={working} onClick={() => void readDetails()}>
                <ScanText className="h-4 w-4" aria-hidden="true" /> Read details from {unreadRows.length} photo{unreadRows.length === 1 ? "" : "s"}
              </Button>
            ) : null}
          </div>
        ) : (
          <EmptyState />
        )}

        <ul className="flex flex-col gap-3" aria-label="Items to add">
          {rows.map((row, index) => (
            <RowEditor
              key={row.id}
              index={index}
              row={row}
              defaults={defaults}
              categoryNames={categoryNames}
              defaultGuide={defaultGuide}
              guideLoading={guideLoading}
              problems={problems.get(row.id) ?? []}
              disabled={working || row.status === "created"}
              onChange={(patch) => editRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
        </ul>
        <datalist id="batch-categories">
          {categoryNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <datalist id="batch-subcategories">
          <option value="LONG" />
          <option value="MINI" />
        </datalist>
      </div>

      {rows.length > 0 ? (
        <div className="sticky bottom-0 z-30 -mx-ws-gutter mt-4 border-t border-dashboard-border bg-dashboard-surface/95 px-ws-gutter py-3 backdrop-blur">
          <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-dashboard-muted" aria-live="polite">
              {working ? (
                <span className="inline-flex items-center gap-2 text-dashboard-navy">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {PHASE_LABEL[phase as Exclude<Phase, "idle">]}
                  {progress ? ` ${progress.done} of ${progress.total}` : ""}
                </span>
              ) : dirty ? (
                "Not saved yet"
              ) : (
                "Saved"
              )}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" variant="secondary" disabled={working || pendingRows.length === 0} onClick={() => void saveForLater()}>
                Save for later
              </Button>
              <Button type="button" disabled={working || readyRows.length === 0} onClick={() => setConfirmOpen(true)}>
                Add {readyRows.length} to clothing
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog.Root open={confirmOpen} onOpenChange={(open: boolean) => !working && setConfirmOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
            <Dialog.Title className="text-lg font-semibold text-dashboard-navy">
              Add {readyRows.length} item{readyRows.length === 1 ? "" : "s"} to your clothing?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
              {pendingRows.length - readyRows.length > 0
                ? `${pendingRows.length - readyRows.length} row${pendingRows.length - readyRows.length === 1 ? " still needs" : "s still need"} details and will stay here. `
                : ""}
              New categories in your rows are created for you.
            </Dialog.Description>
            <label className="mt-4 flex items-start gap-3 rounded-lg border border-dashboard-border p-3 text-sm text-dashboard-navy">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-dashboard-accent" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
              <span>
                Publish right away
                <span className="block text-xs text-dashboard-muted">Off: added as drafts you can review first. Items without a photo always stay drafts.</span>
              </span>
            </label>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" disabled={working} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={working} onClick={() => void addToClothing()}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {publish ? "Add and publish" : "Add as drafts"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-dashboard-border bg-dashboard-surface px-6 py-10 text-center">
      <p className="text-base font-medium text-dashboard-navy">Start with your photos</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-dashboard-muted">
        Pick a whole folder of product photos or a spreadsheet of your stock. Each photo becomes one item you can check and
        edit before anything is saved.
      </p>
    </div>
  );
}

function DefaultsPanel({
  defaults,
  disabled,
  categoryNames,
  onChange,
  onApplyCategory,
}: {
  defaults: ImportDefaults;
  disabled: boolean;
  categoryNames: string[];
  onChange: (patch: Partial<ImportDefaults>) => void;
  onApplyCategory: (category: string) => void;
}) {
  const [category, setCategory] = useState("");
  return (
    <details className="group rounded-xl border border-dashboard-border bg-dashboard-surface p-4">
      <summary className="cursor-pointer text-sm font-medium text-dashboard-navy">Settings for every item</summary>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Pricing">
          <select
            className="h-ws-control w-full rounded-md border border-dashboard-border bg-dashboard-surface px-3 text-ws-input text-dashboard-navy"
            value={defaults.pricingMode}
            disabled={disabled}
            onChange={(event) => onChange({ pricingMode: event.target.value as ImportDefaults["pricingMode"] })}
          >
            <option value="fixed_duration">Price per rental</option>
            <option value="daily">Price per day</option>
          </select>
        </Field>
        {defaults.pricingMode === "fixed_duration" ? (
          <>
            <Field label="Days included">
              <Input inputMode="numeric" value={defaults.includedDays} disabled={disabled} onChange={(event) => onChange({ includedDays: event.target.value })} />
            </Field>
            <Field label="Extra day (₱)">
              <Input inputMode="decimal" value={defaults.extraDayPrice} disabled={disabled} onChange={(event) => onChange({ extraDayPrice: event.target.value })} />
            </Field>
          </>
        ) : null}
        <Field label="Deposit (₱)">
          <Input inputMode="decimal" value={defaults.deposit} disabled={disabled} onChange={(event) => onChange({ deposit: event.target.value })} />
        </Field>
        <Field label="Recovery days">
          <Input inputMode="numeric" value={defaults.recoveryDays} disabled={disabled} onChange={(event) => onChange({ recoveryDays: event.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Category for rows without one" className="sm:w-72">
          <Input list="batch-categories" value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value)} placeholder={categoryNames[0] ?? "e.g. Evening Dresses"} />
        </Field>
        <Button type="button" variant="secondary" disabled={disabled || !category.trim()} onClick={() => onApplyCategory(category.trim())}>
          Apply
        </Button>
      </div>
    </details>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-dashboard-muted">{label}</span>
      {children}
    </label>
  );
}

function RowThumb({ photo }: { photo: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) return;
    const next = URL.createObjectURL(photo);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo]);
  return (
    <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashboard-border bg-dashboard-active sm:h-32 sm:w-24">
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImagePlus className="h-5 w-5 text-dashboard-muted" aria-hidden="true" />}
    </div>
  );
}

const STATUS_TEXT: Record<ImportRow["status"], string> = {
  draft: "",
  uploading: "Uploading photo…",
  reading: "Reading photo…",
  saving: "Adding…",
  created: "Added",
  error: "Needs attention",
};

function RowEditor({
  index,
  row,
  defaults,
  categoryNames,
  defaultGuide,
  guideLoading,
  problems,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  row: ImportRow;
  defaults: ImportDefaults;
  categoryNames: string[];
  defaultGuide: MeasurementGuide | null;
  guideLoading: boolean;
  problems: Array<{ field: string; message: string }>;
  disabled: boolean;
  onChange: (patch: Partial<ImportRow>) => void;
  onRemove: () => void;
}) {
  const invalid = (field: string) => problems.some((problem) => problem.field === field);
  const label = row.name.trim() || `Item ${index + 1}`;
  const inputClass = (field: string) => cn(invalid(field) && "border-dashboard-danger/60");
  return (
    <li
      className={cn(
        "rounded-xl border bg-dashboard-surface p-3 sm:p-4 [content-visibility:auto] [contain-intrinsic-size:auto_220px]",
        row.status === "error" ? "border-dashboard-danger/40" : "border-dashboard-border"
      )}
      aria-label={label}
    >
      <div className="flex gap-3 sm:gap-4">
        <RowThumb photo={row.photo} />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-6">
          <Field label="Name" className="col-span-2 lg:col-span-2">
            <Input value={row.name} disabled={disabled} className={inputClass("name")} onChange={(event) => onChange({ name: event.target.value })} />
          </Field>
          <Field label="Category" className="col-span-2 lg:col-span-2">
            <Input
              list="batch-categories"
              value={row.category}
              disabled={disabled}
              className={inputClass("category")}
              placeholder={categoryNames[0] ?? "Category"}
              onChange={(event) => onChange({ category: event.target.value })}
            />
          </Field>
          <Field label="Subcategory" className="col-span-2 lg:col-span-2">
            <Input
              list="batch-subcategories"
              value={row.subcategory}
              maxLength={120}
              disabled={disabled}
              className={inputClass("subcategory")}
              placeholder="None, LONG, MINI or custom"
              onChange={(event) => onChange({ subcategory: event.target.value })}
            />
          </Field>
          <Field label="Rental price (₱)">
            <Input inputMode="decimal" value={row.price} disabled={disabled} className={inputClass("price")} onChange={(event) => onChange({ price: event.target.value })} />
          </Field>
          <Field label="Deposit (₱)">
            <Input inputMode="decimal" value={row.deposit} placeholder={defaults.deposit} disabled={disabled} className={inputClass("deposit")} onChange={(event) => onChange({ deposit: event.target.value })} />
          </Field>
          <Field label="Size" className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2">
              <select
                aria-label={`Sizing mode for ${label}`}
                className="h-ws-control shrink-0 rounded-md border border-dashboard-border bg-dashboard-surface px-2 text-ws-input text-dashboard-navy"
                value={row.freeSize ? "free_size" : "sized"}
                disabled={disabled}
                onChange={(event) => onChange({ freeSize: event.target.value === "free_size" })}
              >
                <option value="sized">Sized</option>
                <option value="free_size">Free size</option>
              </select>
              {row.freeSize ? (
                <Input value={row.fitNote} placeholder="Fit note, e.g. Fits Small to XL" disabled={disabled} onChange={(event) => onChange({ fitNote: event.target.value })} />
              ) : (
                <Input value={row.sizeLabel} placeholder="e.g. M" disabled={disabled} className={inputClass("sizeLabel")} onChange={(event) => onChange({ sizeLabel: event.target.value })} />
              )}
            </div>
          </Field>
          <fieldset className="col-span-2 min-w-0 lg:col-span-3">
            <legend className="mb-1 text-xs font-medium text-dashboard-muted">Measurements</legend>
            <div className="space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <select
                  aria-label={`Measurement mode for ${label}`}
                  className={cn(
                    "h-ws-control min-w-40 rounded-md border border-dashboard-border bg-dashboard-surface px-2 text-ws-input text-dashboard-navy",
                    inputClass("measurementMode")
                  )}
                  value={row.measurementMode}
                  disabled={disabled}
                  onChange={(event) => onChange({ measurementMode: event.target.value as ImportRow["measurementMode"] })}
                >
                  <option value="default_guide" disabled={!defaultGuide && !guideLoading}>Default guide</option>
                  <option value="custom">Custom measurements</option>
                  <option value="none">No measurements</option>
                </select>
                {row.measurementMode === "default_guide" ? (
                  <span className="truncate text-xs text-dashboard-muted">
                    {guideLoading ? "Loading guide…" : defaultGuide?.name ?? "No default guide set"}
                  </span>
                ) : null}
              </div>
              {row.measurementMode === "custom" ? (
                <div className="grid grid-cols-5 gap-1.5">
                  {MEASUREMENT_FIELDS.map((field) => (
                    <Input
                      key={field}
                      aria-label={`${field} (${row.unit})`}
                      placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                      inputMode="decimal"
                      value={row[field]}
                      disabled={disabled}
                      className={cn("px-2", inputClass(field))}
                      onChange={(event) => onChange({ [field]: event.target.value })}
                    />
                  ))}
                  <select
                    aria-label="Measurement unit"
                    className="h-ws-control rounded-md border border-dashboard-border bg-dashboard-surface px-1.5 text-ws-input text-dashboard-navy"
                    value={row.unit}
                    disabled={disabled}
                    onChange={(event) => onChange({ unit: event.target.value as ImportRow["unit"] })}
                  >
                    <option value="in">in</option>
                    <option value="cm">cm</option>
                  </select>
                </div>
              ) : null}
            </div>
          </fieldset>
          <Field label="Color">
            <Input value={row.color} disabled={disabled} onChange={(event) => onChange({ color: event.target.value })} />
          </Field>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove} className="shrink-0">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {row.status !== "draft" || row.message || problems.length > 0 ? (
        <p className={cn("mt-2 text-xs", row.status === "error" || row.message ? "text-dashboard-danger" : "text-dashboard-muted")}>
          {[STATUS_TEXT[row.status], row.message, row.status === "draft" ? problems.map((problem) => problem.message).join(" ") : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

