import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("retired /fittings/schedule route", () => {
  it("has no production route file", () => {
    expect(
      existsSync(join(process.cwd(), "src/app/(dashboard)/fittings/schedule/page.tsx")),
    ).toBe(false);
  });
});
