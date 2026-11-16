# QA report and defect evidence

The scenario matrix tracks scenario ID, feature and requirement, scenario/input, expected and actual results, test category, risk, status (Pending, Pass, Fail, Blocked, N/A), and actual evidence paths. Separate logical scenarios, test cases, and retry attempts; never invent counts. Record why a relevant category is blocked or not applicable.

For every confirmed or suspected defect include an ID, title, severity and affected component; verified expected versus actual behavior; safe reproduction steps and scenario; evidence for the failure; a clearly qualified likely cause and suggested fix; and actual video/screenshot paths or an explicit explanation when unavailable. Do not assert a cause or create artifact links without evidence.

The final Markdown report contains feature and scope, requirements/assumptions/exclusions, actual commands and execution results for applicable test levels, the scenario matrix, defects, videos/screenshots/HTML report, visual QA observations, and remaining coverage, flaky tests, environment limitations, and release risks. Give exactly one overall status:

- **PASS**: all required high-priority checks and evidence are complete, with no unresolved critical defects.
- **FAIL**: a confirmed application defect or unmet critical functional requirement causes required checks to fail.
- **BLOCKED**: required verification cannot be completed reliably due to missing requirements, unsafe environments, unavailable dependencies, missing required evidence, or other execution limits.

Report the commands and actual results. Never count blocked tests as passing or claim comprehensive visual correctness based only on automated assertions.
