import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultStorefrontDocument, type StorefrontPolicyRules, type StorefrontSettings } from "@drezivo/contracts";

import { StorefrontEditorProvider } from "@/components/storefront/storefront-editor";
import { StorefrontPoliciesPage } from "@/components/storefront/storefront-policy-pages";

const clerk = vi.hoisted(() => ({ getToken: vi.fn(), useAuth: vi.fn() }));
const api = vi.hoisted(() => ({ getStorefront: vi.fn(), publishStorefrontPolicy: vi.fn() }));
const upload = vi.hoisted(() => ({ uploadStorefrontImage: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({ useAuth: clerk.useAuth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/storefront/policies" }));
vi.mock("@/lib/drezivo-api", () => ({
  DrezivoApiError: class DrezivoApiError extends Error {
    code = "INTERNAL_ERROR";
  },
  createDrezivoApiClient: () => api,
}));
vi.mock("@/lib/storefront-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storefront-assets")>()),
  uploadStorefrontImage: upload.uploadStorefrontImage,
}));

const pageOne = "00000000-0000-4000-8000-000000000101";
const pageTwo = "00000000-0000-4000-8000-000000000102";

function settings(rules: StorefrontPolicyRules | null = null): StorefrontSettings {
  return {
    slug: "luna-gowns",
    status: "draft",
    version: 3,
    published_at: null,
    updated_at: "2026-09-29T02:00:00.000Z",
    public_path: "/s/luna-gowns",
    document: defaultStorefrontDocument("Luna Gown Rentals"),
    media: { logo_url: null, cover_url: null, hero_image_url: null, about_image_url: null },
    policy: { version: 1, effective_at: "2026-09-29T02:00:00.000Z", rules, image_urls: {} },
    readiness: { has_policy: false, has_active_clothing: true, has_storefront_payment_method: true, has_contact: false, ready: false },
  };
}

const page = (name: string) => new File(["policy"], name, { type: "image/png", lastModified: 1 });

async function openImageMode() {
  render(
    <StorefrontEditorProvider>
      <StorefrontPoliciesPage />
    </StorefrontEditorProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Upload images" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Privacy notice" }), {
    target: { value: "We use your details only for this rental." },
  });
}

describe("rental terms as images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStorefront.mockResolvedValue({ data: settings(), requestId: "r" });
    api.publishStorefrontPolicy.mockResolvedValue({ data: settings(), requestId: "r" });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:policy-page");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("uploads several pages, keeps the chosen order, and publishes once", async () => {
    upload.uploadStorefrontImage.mockResolvedValueOnce(pageOne).mockResolvedValueOnce(pageTwo);
    await openImageMode();

    fireEvent.change(screen.getByLabelText(/Upload your policy/), { target: { files: [page("p1.png"), page("p2.png")] } });
    expect(await screen.findByText("Page 2")).toBeVisible();
    expect(screen.getByText("Page 1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    const publish = screen.getByRole("button", { name: "Publish policy" });
    fireEvent.click(publish);
    fireEvent.click(publish);

    await waitFor(() => expect(api.publishStorefrontPolicy).toHaveBeenCalledTimes(1));
    const [body] = api.publishStorefrontPolicy.mock.calls[0] as [{ rules: { format: string; image_file_ids: string[] } }];
    expect(body.rules.format).toBe("images");
    expect(body.rules.image_file_ids).toEqual([pageTwo, pageOne]);
  });

  it("holds Publish while pages are still uploading", async () => {
    let finish!: (id: string) => void;
    upload.uploadStorefrontImage.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    await openImageMode();

    fireEvent.change(screen.getByLabelText(/Upload your policy/), { target: { files: [page("p1.png")] } });
    expect(await screen.findByText("Wait for the pages to finish uploading.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish policy" })).toBeDisabled();

    finish(pageOne);
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish policy" })).toBeEnabled());
  });

  it("asks for at least one page before publishing image terms", async () => {
    await openImageMode();
    fireEvent.click(screen.getByRole("button", { name: "Publish policy" }));

    expect(await screen.findByText("Add at least one image of your policy")).toBeVisible();
    expect(api.publishStorefrontPolicy).not.toHaveBeenCalled();
  });
});

describe("privacy notice starter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clerk.getToken.mockResolvedValue("token");
    clerk.useAuth.mockReturnValue({ getToken: clerk.getToken });
    api.getStorefront.mockResolvedValue({ data: settings(), requestId: "r" });
    api.publishStorefrontPolicy.mockResolvedValue({ data: settings(), requestId: "r" });
  });

  it("prefills and counts an editable privacy draft without publishing it", async () => {
    render(
      <StorefrontEditorProvider>
        <StorefrontPoliciesPage />
      </StorefrontEditorProvider>
    );

    const textarea = await screen.findByRole("textbox", { name: "Privacy notice" });
    expect(textarea).toHaveValue(
      "Your shop uses the information you provide, such as your name, email, phone number, rental or fitting details, and, for reservations, your pickup or delivery address, to manage your request, arrange pickup or delivery, and contact you. Depending on your request, this may also include the selected item and dates, event date, social-media handle, fitting note, and any payment proof you submit. Drezivo processes this information for the shop to provide the booking service. Contact the shop through its storefront details with privacy questions."
    );
    expect(
      screen.getByText(`${(textarea as HTMLTextAreaElement).value.length}/2000`)
    ).toBeVisible();
    expect(api.publishStorefrontPolicy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publish policy" })).toBeEnabled();
  });

  it("preserves a nonblank saved privacy notice", async () => {
    const savedNotice = "Keep this shop-specific privacy wording.";
    const rules: StorefrontPolicyRules = {
      format: "text",
      rental: "",
      deposit: "",
      cancellation: "",
      damage: null,
      image_file_ids: [],
      delivery: { enabled: false, fee_minor: "0", notes: null },
      privacy_notice: savedNotice,
    };
    api.getStorefront.mockResolvedValue({ data: settings(rules), requestId: "r" });

    render(
      <StorefrontEditorProvider>
        <StorefrontPoliciesPage />
      </StorefrontEditorProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Privacy notice" })).toHaveValue(savedNotice)
    );
  });
});
