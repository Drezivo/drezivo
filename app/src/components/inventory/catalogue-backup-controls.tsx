"use client";

import { useAuth } from "@clerk/nextjs";
import { ArchiveRestore, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MAX_CATALOGUE_BACKUP_BYTES, type CatalogueBackupExportStatus, type CatalogueBackupImportPreview } from "@drezivo/contracts";

import { Button } from "@/components/ui/button";
import { createDrezivoApiClient } from "@/lib/drezivo-api";
import { uploadAuthorizedFile } from "@/lib/authorized-file-upload";

function newIntentKey(): string {
  return crypto.randomUUID();
}

function formatDate(value: string | null): string | null {
  return value ? new Date(value).toLocaleString() : null;
}

function sha256Base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function CatalogueBackupControls({
  onRestored,
  toolbarActions,
}: {
  onRestored: () => void;
  toolbarActions?: ReactNode;
}) {
  const { getToken } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportJob, setExportJob] = useState<CatalogueBackupExportStatus | null>(null);
  const [preview, setPreview] = useState<CatalogueBackupImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const jobId = exportJob?.job_id;
  const jobStatus = exportJob?.status;

  useEffect(() => {
    if (!jobId || (jobStatus !== "pending" && jobStatus !== "running")) return;
    let cancelled = false;
    let checking = false;
    const interval = window.setInterval(() => {
      if (checking) return;
      checking = true;
      void createDrezivoApiClient(getToken).getCatalogueBackupExportStatus(jobId).then((result) => {
        if (!cancelled) setExportJob(result.data.job);
      }).catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Export status could not be checked.");
      }).finally(() => {
        checking = false;
      });
    }, 1800);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [jobId, jobStatus, getToken]);

  const startExport = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createDrezivoApiClient(getToken).startCatalogueBackupExport(newIntentKey());
      setExportJob(result.data.job);
      if (result.data.job.status === "completed") setMessage("Your latest inventory backup is ready to download.");
      else if (result.data.job.status === "failed") setError("The previous export failed. You can try again.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inventory export could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const downloadExport = async () => {
    if (!exportJob) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await createDrezivoApiClient(getToken).downloadCatalogueBackupExport(exportJob.job_id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "drezivo-inventory-backup.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inventory backup could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const previewFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (file.size > MAX_CATALOGUE_BACKUP_BYTES) throw new Error("Inventory backups must be 64 MB or smaller.");
      const api = createDrezivoApiClient(getToken);
      const digest = sha256Base64(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      const authorization = await api.authorizeUpload({
        purpose: "catalogue_backup",
        content_type: "application/zip",
        byte_size: file.size,
        sha256: digest,
      }, newIntentKey());
      await uploadAuthorizedFile(authorization.data, file, "The inventory backup could not be uploaded.");
      await api.finalizeUpload(authorization.data.file_id, newIntentKey());
      const result = await api.previewCatalogueBackupImport(authorization.data.file_id, newIntentKey());
      setPreview(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inventory backup could not be previewed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const commitRestore = async () => {
    if (!preview || preview.conflicts.length > 0 || preview.conflicts_truncated) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createDrezivoApiClient(getToken).commitCatalogueBackupImport(preview.import_id, newIntentKey());
      const total = Object.values(result.data.created).reduce<number>((sum, count) => sum + count, 0);
      setMessage(`Restore complete. ${total} catalogue records and links were added; existing records were left unchanged.`);
      setPreview(null);
      onRestored();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inventory restore could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const nextExport = formatDate(exportJob?.available_at ?? null);
  const downloadReady = exportJob?.status === "completed" && (!exportJob.expires_at || new Date(exportJob.expires_at).getTime() > Date.now());
  const restoreCount = preview ? Object.values(preview.counts).reduce((sum, count) => sum + count, 0) : 0;
  const exportRunning = exportJob?.status === "pending" || exportJob?.status === "running";

  return (
    <div className="min-w-0 w-full space-y-2 md:ml-auto md:max-w-3xl 2xl:flex-1 2xl:max-w-none">
      <div className="grid grid-cols-2 gap-2 2xl:flex 2xl:flex-wrap 2xl:items-center 2xl:justify-end">
        <Button
          type="button"
          variant="secondary"
          className="w-full min-w-0 2xl:w-auto 2xl:shrink-0"
          onClick={() => void startExport()}
          disabled={busy || exportRunning}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {exportRunning ? "Preparing backup…" : "Export inventory"}
        </Button>
        {downloadReady ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full min-w-0 2xl:w-auto 2xl:shrink-0"
            onClick={() => void downloadExport()}
            disabled={busy}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download backup
          </Button>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          aria-label="Choose inventory backup ZIP"
          className="sr-only"
          onChange={(event) => void previewFile(event.currentTarget.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          className="w-full min-w-0 2xl:w-auto 2xl:shrink-0"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Restore backup
        </Button>
        {toolbarActions}
      </div>

      {exportRunning ? <p role="status" className="text-right text-xs text-dashboard-muted">Your private inventory backup is being prepared.</p> : null}
      {nextExport ? <p className="text-right text-xs text-dashboard-muted">Next export available {nextExport}. You can download an existing backup without using another export.</p> : null}
      {error ? <p role="alert" className="text-right text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-right text-sm text-dashboard-muted">{message}</p> : null}

      {preview ? (
        <div className="rounded-lg border border-dashboard-border bg-dashboard-surface p-3 text-sm">
          <div className="flex items-start gap-2">
            <ArchiveRestore className="mt-0.5 h-4 w-4 shrink-0 text-dashboard-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-dashboard-navy">Restore preview</p>
              <p className="mt-1 text-xs text-dashboard-muted">Adds {restoreCount} missing records, links, and images. Existing catalogue records are unchanged; nothing is deleted.</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-dashboard-muted sm:grid-cols-3">
                <div><dt>Categories</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.categories_to_create}</dd></div>
                <div><dt>Styles</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.products_to_create}</dd></div>
                <div><dt>Variants</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.variants_to_create}</dd></div>
                <div><dt>Pieces</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.pieces_to_create}</dd></div>
                <div><dt>Guides</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.guides_to_create}</dd></div>
                <div><dt>Images</dt><dd className="font-semibold text-dashboard-navy">{preview.counts.images_to_restore}</dd></div>
              </dl>
              {preview.conflicts.length > 0 || preview.conflicts_truncated ? (
                <div className="mt-2 rounded-md border border-warning-500/30 bg-warning-500/10 p-2 text-xs text-dashboard-navy">
                  <p className="font-medium">Resolve the reported conflicts before restoring.</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {preview.conflicts.map((conflict) => <li key={`${conflict.entity}:${conflict.id}`}>{conflict.entity}: {conflict.reason}</li>)}
                  </ul>
                  {preview.conflicts_truncated ? <p className="mt-1">Additional conflicts were found.</p> : null}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {restoreCount > 0 ? (
                  <Button type="button" size="sm" onClick={() => void commitRestore()} disabled={busy || preview.conflicts.length > 0 || preview.conflicts_truncated}>
                    Restore missing inventory
                  </Button>
                ) : <p className="text-xs font-medium text-dashboard-muted">Everything in this backup is already present.</p>}
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
