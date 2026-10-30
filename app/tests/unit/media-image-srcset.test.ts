import { describe, expect, it } from "vitest";

import { mediaImageSrcSet } from "@/lib/media-image-srcset";

describe("staff media image srcset", () => {
  it("does not generate unauthenticated browser URLs for staff images", () => {
    expect(mediaImageSrcSet("https://api.example.test/api/v1/files/media/staff/file-id?branch_id=branch-id&w=960")).toBeUndefined();
  });

  it("leaves upload previews and non-media URLs unchanged", () => {
    expect(mediaImageSrcSet("blob:https://drezivo.example/local-file")).toBeUndefined();
    expect(mediaImageSrcSet("https://images.example.test/photo.jpg")).toBeUndefined();
    expect(mediaImageSrcSet(undefined)).toBeUndefined();
  });
});
