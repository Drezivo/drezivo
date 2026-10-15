import { describe, expect, it } from "vitest";

import { mediaImageSrcSet } from "@/lib/media-image-srcset";

describe("staff media image srcset", () => {
  it("requests bounded private variants for app-owned media routes", () => {
    expect(mediaImageSrcSet("/api/media/staff/file-id?branch_id=branch-id&w=960")).toBe(
      "/api/media/staff/file-id?branch_id=branch-id&w=320 320w, /api/media/staff/file-id?branch_id=branch-id&w=960 960w, /api/media/staff/file-id?branch_id=branch-id&w=1600 1600w",
    );
  });

  it("leaves upload previews and non-media URLs unchanged", () => {
    expect(mediaImageSrcSet("blob:https://drezivo.example/local-file")).toBeUndefined();
    expect(mediaImageSrcSet("https://images.example.test/photo.jpg")).toBeUndefined();
    expect(mediaImageSrcSet(undefined)).toBeUndefined();
  });
});
