import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";

describe("Drezivo dashboard API client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    getToken.mockReset();
    getToken.mockResolvedValue("session");
    fetchMock.mockRejectedValue(new Error("test network stop"));
    vi.stubGlobal("fetch", fetchMock);
    process.env["NEXT_PUBLIC_API_ORIGIN"] = "https://api.example.test";
  });

  it("sends optional month bounds, all-time selection, and the unfiltered default", async () => {
    const client = createDrezivoApiClient(getToken);
    await expect(client.getDashboardOverview()).rejects.toBeInstanceOf(DrezivoApiError);
    await expect(
      client.getDashboardOverview({ start_month: "2026-10", end_month: "2026-11" })
    ).rejects.toBeInstanceOf(DrezivoApiError);
    await expect(client.getDashboardOverview({ all_time: "true" })).rejects.toBeInstanceOf(
      DrezivoApiError
    );

    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const rangeUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    const allTimeUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(firstUrl.pathname).toBe("/api/v1/dashboard/overview");
    expect(firstUrl.search).toBe("");
    expect(rangeUrl.searchParams.get("start_month")).toBe("2026-10");
    expect(rangeUrl.searchParams.get("end_month")).toBe("2026-11");
    expect(allTimeUrl.searchParams.get("all_time")).toBe("true");
  });

  it("rejects invalid ranges before sending a request", async () => {
    const client = createDrezivoApiClient(getToken);

    expect(() =>
      client.getDashboardOverview({ start_month: "2026-11", end_month: "2026-10" })
    ).toThrow();
    expect(() => client.getDashboardOverview({ all_time: "true", end_month: "2026-10" })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
