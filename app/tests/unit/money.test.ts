import { describe, expect, it } from "vitest";
import { addPhp, comparePhp, formatPhp, InvalidMoneyStringError, subtractPhp } from "@/lib/money";

describe("money", () => {
  it("formats a decimal string as PHP currency", () => {
    expect(formatPhp("1500")).toBe("₱1,500.00");
    expect(formatPhp("1500.5")).toBe("₱1,500.50");
    expect(formatPhp("0.00")).toBe("₱0.00");
  });

  it("adds decimal strings exactly, without float drift", () => {
    // 0.1 + 0.2 famously != 0.3 in float arithmetic; the PRD's worked example
    // (rental 1500 + deposit 2000 = 3500) must be exact too.
    expect(addPhp("0.10", "0.20")).toBe("0.30");
    expect(addPhp("1500.00", "2000.00")).toBe("3500.00");
  });

  it("subtracts decimal strings exactly", () => {
    expect(subtractPhp("2000.00", "750.50")).toBe("1249.50");
  });

  it("compares decimal strings without converting through a lossy float", () => {
    expect(comparePhp("100.00", "100.00")).toBe(0);
    expect(comparePhp("99.99", "100.00")).toBe(-1);
    expect(comparePhp("100.01", "100.00")).toBe(1);
  });

  it("rejects a malformed amount instead of silently truncating it like parseFloat would", () => {
    expect(() => formatPhp("1500.00abc")).toThrow(InvalidMoneyStringError);
    expect(() => formatPhp("")).toThrow(InvalidMoneyStringError);
    expect(() => formatPhp("PHP 1500")).toThrow(InvalidMoneyStringError);
  });
});
