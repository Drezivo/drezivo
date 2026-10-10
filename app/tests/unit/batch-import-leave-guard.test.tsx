import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));

import { LeaveGuard } from "@/components/inventory/batch-import/leave-guard";

function openGuard(onSaveForLater = vi.fn<() => Promise<boolean>>()) {
  render(
    <>
      <Link href="/inventory">Inventory</Link>
      <LeaveGuard active pendingCount={2} onSaveForLater={onSaveForLater} />
    </>
  );
  fireEvent.click(screen.getByRole("link", { name: "Inventory" }));
  return onSaveForLater;
}

describe("batch-add leave guard", () => {
  beforeEach(() => navigation.push.mockReset());

  it("keeps all leave actions visible as a responsive aligned group", () => {
    openGuard();

    const dialog = screen.getByRole("dialog", { name: "Leave batch add?" });
    const keepEditing = screen.getByRole("button", { name: "Keep editing" });
    const leaveWithoutSaving = screen.getByRole("button", { name: "Leave without saving" });
    const saveForLater = screen.getByRole("button", { name: "Save for later & leave" });
    const actions = keepEditing.parentElement;

    expect(dialog).toHaveClass("max-w-xl");
    expect(actions).toHaveClass("flex-col", "sm:flex-row", "sm:flex-wrap");
    expect(keepEditing).toHaveClass("w-full", "sm:w-auto", "whitespace-nowrap");
    expect(leaveWithoutSaving).toHaveClass("w-full", "sm:w-auto", "whitespace-nowrap");
    expect(saveForLater).toHaveClass("w-full", "sm:w-auto", "whitespace-nowrap");
  });

  it("keeps editing without navigating or saving", () => {
    const save = openGuard();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves without saving when that action is selected", () => {
    const save = openGuard();
    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));

    expect(navigation.push).toHaveBeenCalledWith("/inventory");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves for later before leaving when that action is selected", async () => {
    const save = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    openGuard(save);
    fireEvent.click(screen.getByRole("button", { name: "Save for later & leave" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/inventory"));
    expect(save).toHaveBeenCalledWith();
  });
});
