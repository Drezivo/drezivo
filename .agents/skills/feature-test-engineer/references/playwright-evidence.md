# Playwright execution and evidence

Read this when real-browser testing is in scope. Inspect the repository's Playwright version, configurations, fixtures, output paths, project overrides, and existing browser dependencies first. Reuse them; do not install new packages or browsers without justification and authorization. Use Chromium by default; use Firefox or WebKit only when relevant to the request. Start or connect to a verified isolated environment and check readiness.

For this skill's runs use an appropriate test-only configuration, avoiding unrelated project or CI changes:

```ts
use: {
  video: 'on',
  screenshot: 'on',
  trace: 'off',
}
```

Ensure all selected projects and fixtures actually inherit these options. Record every executed E2E attempt, including passes, failures, and retries. Configure one automatic final screenshot per attempt and no action-by-action captures, DOM/action snapshots, traces, or visual-regression snapshots unless the user explicitly requests visual regression. Avoid extra manual screenshots; account for custom fixtures and multiple pages that could generate more than one. If a runner, fixture, early setup failure, crash, or environment limitation prevents exactly one final screenshot or a readable video, report the real artifact count and mark evidence incomplete; never fabricate or substitute an earlier screenshot.

Navigate real pages, fill real forms, check accessible controls and meaningful business outcomes, and verify the relevant API response or persisted side effect when appropriate. Use role/label locators, stable test IDs as needed, web-first assertions, deterministic data and no arbitrary sleep. Exercise relevant failure, repeated-action, navigation, network, concurrency, and permission cases. Inspect the video and final screenshot for visible issues; passing functional assertions alone do not prove visual correctness.

Store artifacts in the existing ignored output directory, organized by feature/scenario/attempt where feasible. Use unique paths so retries do not overwrite artifacts. Preserve videos and screenshots for passing and failing attempts and provide an HTML report when supported. Verify each generated file is nonempty, readable, tied to the actual scenario and attempt, and free of secrets and sensitive data before exposing it. Record actual paths; do not claim capture before execution or invent paths.
