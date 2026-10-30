import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogueBackupControls } from "@/components/inventory/catalogue-backup-controls";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({
  startCatalogueBackupExport: vi.fn(),
  getCatalogueBackupExportStatus: vi.fn(),
  downloadCatalogueBackupExport: vi.fn(),
  authorizeUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  previewCatalogueBackupImport: vi.fn(),
  commitCatalogueBackupImport: vi.fn(),
}));
const upload = vi.hoisted(() => ({ uploadAuthorizedFile: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("@/lib/drezivo-api", () => ({ createDrezivoApiClient: () => api }));
vi.mock("@/lib/authorized-file-upload", () => ({ uploadAuthorizedFile: upload.uploadAuthorizedFile }));

describe("CatalogueBackupControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.startCatalogueBackupExport.mockResolvedValue({ data: { job: {
      job_id: "00000000-0000-4000-8000-000000000001",
      status: "completed",
      available_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    } } });
    api.downloadCatalogueBackupExport.mockResolvedValue(new Blob(["zip"]));
    api.authorizeUpload.mockResolvedValue({ data: {
      file_id: "00000000-0000-4000-8000-000000000002",
      upload_url: "https://uploads.example.test/zip",
      upload_method: "PUT",
      required_headers: {},
      expires_at: "2099-01-01T00:00:00.000Z",
    } });
    api.finalizeUpload.mockResolvedValue({ data: {} });
    api.previewCatalogueBackupImport.mockResolvedValue({ data: {
      import_id: "00000000-0000-4000-8000-000000000003",
      branch_id: "00000000-0000-4000-8000-000000000004",
      counts: { categories_to_create: 0, products_to_create: 1, variants_to_create: 1, pieces_to_create: 1, guides_to_create: 0, images_to_restore: 0 },
      conflicts: [],
      conflicts_truncated: false,
      expires_at: "2099-01-01T00:00:00.000Z",
    } });
    api.commitCatalogueBackupImport.mockResolvedValue({ data: {
      import_id: "00000000-0000-4000-8000-000000000003",
      status: "committed",
      created: { categories_to_create: 0, products_to_create: 1, variants_to_create: 1, pieces_to_create: 1, guides_to_create: 0, images_to_restore: 0 },
    } });
    upload.uploadAuthorizedFile.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000099",
      subtle: { digest: async () => new Uint8Array(32).buffer },
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:backup", revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("starts and downloads a completed branch export and previews then commits an additive restore", async () => {
    const onRestored = vi.fn();
    render(<CatalogueBackupControls onRestored={onRestored} />);

    fireEvent.click(screen.getByRole("button", { name: "Export inventory" }));
    await screen.findByRole("button", { name: "Download backup" });
    expect(screen.getByText(/Next export available/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(api.downloadCatalogueBackupExport).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001"));

    const file = new File(["zip"], "drezivo-inventory.zip", { type: "application/zip" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
    fireEvent.change(screen.getByLabelText("Choose inventory backup ZIP"), { target: { files: [file] } });
    await screen.findByText("Restore preview");
    expect(screen.getByText(/Adds 3 missing records/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore missing inventory" }));
    await screen.findByText(/Restore complete/);
    expect(api.commitCatalogueBackupImport).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000003", expect.any(String));
    expect(onRestored).toHaveBeenCalledOnce();
  });
});
