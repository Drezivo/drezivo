---
name: feature-test-engineer
description: Perform explicitly requested, risk-based feature QA with executable tests, real-browser evidence, and a structured report.
---

# Feature test engineer

Use only when the user explicitly invokes `$feature-test-engineer` or explicitly names this skill or its testing agent. Ordinary implementation requests and generic references to tests are not permission to run this complete workflow. Respect the current user request, repository instructions, available tools, execution permissions, and safety boundaries; do not delegate unless authorized by the active environment.

## Workflow

1. Inspect repository guidance and existing tests, scripts, CI, fixtures, environment configuration, contracts, and observability before choosing tools. Respect repository-specific discovery rules, such as Graphify where required. Trace the requested feature through its UI, API, authorization, persistence, workers, and integrations as applicable. Distinguish documented requirements, observed behavior, and assumptions; request essential missing acceptance criteria instead of inventing them.
2. Before test changes or execution, build a risk-ranked scenario matrix with scenario ID, feature, requirement, input, expected outcome, test level, risk, status, and evidence. Cover relevant success, failure, validation, boundary, permission, persistence, idempotency, concurrency, UX, and integration cases; mark inapplicable cases N/A with a reason. Choose depth based on actual impact and risk, not test count.
3. Reuse existing frameworks and safe fixtures. Implement and execute meaningful applicable unit, integration, and client/API compatibility tests; verify actual business outcomes and persisted side effects. Use real isolated components where appropriate and controlled mocks only for external or unsafe effects. Never mock the logic being verified or weaken assertions to hide failures. Run only relevant suites and avoid conflicting shared-state tests.
4. If a browser workflow is relevant and a safe environment is available, execute real Playwright end-to-end tests and inspect actual UX with the evidence requirements in [references/playwright-evidence.md](references/playwright-evidence.md). Perform concurrency and persistence checks via API or database when a browser cannot prove them. Do not substitute mocked component tests for real end-to-end verification.
5. Investigate failures against implementation, logs, network, data state, and available artifacts. Classify each as confirmed application defect, suspected defect, faulty test, environment failure, flaky, or blocked; do not assert a root cause without evidence. Follow [references/reporting.md](references/reporting.md) for defects and the final report.

## Boundaries

- Use only verified isolated development/test services, test accounts, dedicated databases and sandbox integrations. Do not run destructive tests against production, use customer data, or perform real financial transactions. Clean up only data created by the test. If safety cannot be established, block affected tests.
- Test files, safe fixtures, and necessary test-only configuration may be changed within the authorized scope. Diagnose application defects by default; obtain explicit authorization before changing business logic or database schema. Ask before adding a dependency and justify it. Never modify application code merely to force a test to pass.
- Record no credentials, tokens, real customer data, or payment evidence in artifacts or reports. Use synthetic data; if safe recording cannot be guaranteed, block the affected recorded scenario. Do not commit test artifacts without an explicit request.
- Continue safe independent checks if prerequisites fail, but never label blocked or unexecuted checks as passed. State exact commands, actual scenario and attempt counts, failures, skipped checks, evidence paths, and environment limits.

## Deliverable

Write a Markdown QA report under the project's ignored test-artifact directory when practical (default `test-results/<feature>/QA-REPORT.md`), and summarize it to the user. Include scope, requirements and assumptions, scenario matrix, actual results, defects and evidence, visual QA limitations, and risks. Give exactly one final status: PASS only when required high-priority checks and evidence are complete without unresolved critical defects; FAIL for confirmed defects or unmet critical requirements; BLOCKED when required verification cannot be completed reliably. See [references/reporting.md](references/reporting.md).
