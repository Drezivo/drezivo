import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  branchBusinessHours,
  branchClosure,
  type BranchClosureId,
} from "@drezivo/contracts";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const branchId = "00000000-0000-4000-8000-000000004001";
const closureId = "00000000-0000-4000-8000-000000004002" as BranchClosureId;

const hours = branchBusinessHours.parse({
  branch_id: branchId,
  branch_name: "Main Branch",
  opens_local: "09:00",
  closes_local: "20:00",
  closed_weekdays: ["sunday"],
  timezone: "Asia/Manila",
  version: 1,
  updated_at: "2026-10-01T00:00:00.000Z",
});

const closure = branchClosure.parse({
  id: closureId,
  branch_id: branchId,
  local_date: "2026-12-25",
  reason: "Christmas Day",
  version: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
});

function success(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ success: true, data, request_id: "00000000-0000-4000-8000-000000004099" }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("Drezivo Business Hours API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("test-token");
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("reads and updates active-branch Business Hours without sending a branch selector", async () => {
    fetchMock
      .mockResolvedValueOnce(success(hours))
      .mockResolvedValueOnce(success({ ...hours, opens_local: "10:00", version: 2 }));
    const client = createDrezivoApiClient(getToken);

    const loaded = await client.getBusinessHours();
    const updated = await client.updateBusinessHours(
      {
        version: 1,
        opens_local: "10:00",
        closes_local: "20:00",
        closed_weekdays: ["sunday"],
      },
      "hours-update-key",
    );

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/api/v1/settings/business-hours",
    );
    const [, updateInit] = fetchMock.mock.calls[1]!;
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).pathname).toBe(
      "/api/v1/settings/business-hours",
    );
    expect(updateInit?.method).toBe("PATCH");
    expect(new Headers(updateInit?.headers).get("Idempotency-Key")).toBe("hours-update-key");
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      version: 1,
      opens_local: "10:00",
      closes_local: "20:00",
      closed_weekdays: ["sunday"],
    });
    expect(loaded.data.branch_name).toBe("Main Branch");
    expect(updated.data.version).toBe(2);
  });

  it("lists and mutates branch closed dates through Settings endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(
        success({ items: [closure], page_meta: { next_cursor: null, has_more: false } }),
      )
      .mockResolvedValueOnce(success({ closure }, 201))
      .mockResolvedValueOnce(success({ closure: { ...closure, reason: "Holiday" , version: 2 } }))
      .mockResolvedValueOnce(success({ closure_id: closureId }));
    const client = createDrezivoApiClient(getToken);

    await client.getBranchClosures({
      limit: 20,
      date_start: "2026-12-01",
      date_end: "2026-12-31",
    });
    await client.createBranchClosure(
      { local_date: "2026-12-25", reason: "Christmas Day" },
      "closure-create-key",
    );
    await client.updateBranchClosure(
      closureId,
      { version: 1, local_date: "2026-12-25", reason: "Holiday" },
      "closure-update-key",
    );
    await client.removeBranchClosure(closureId, { version: 2 }, "closure-remove-key");

    const listUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listUrl.pathname).toBe("/api/v1/settings/business-hours/closures");
    expect(listUrl.searchParams.get("date_start")).toBe("2026-12-01");
    expect(listUrl.searchParams.get("date_end")).toBe("2026-12-31");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("POST");
    expect(new URL(String(fetchMock.mock.calls[3]?.[0])).pathname).toBe(
      `/api/v1/settings/business-hours/closures/${closureId}/remove`,
    );
  });
});
