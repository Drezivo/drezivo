# Engineering Standards — write it like company code

> AUTO-LOADED. Unconditional standing directive, installed in every project.
> The bar is NOT "the code runs". The bar is: a developer who has never met you must be able
> to read it, debug it at 2am, change it when the requirement changes, and scale it — without
> asking you anything. Code that only satisfies the demo is unfinished work.

## 0. The one question that governs all others

Before calling anything done, answer honestly: **if I disappeared tomorrow, could the next
developer maintain this?** If the answer depends on knowledge that exists only in your head or
only in this chat, the work is not done — write it down or restructure it until it is.

## 1. CLEAN — readable, changeable, maintainable

Clean does NOT mean short. Clean does NOT mean prettily formatted. Clean means legible intent.

Every change must pass all four:

1. **Will another developer understand this?** Names say what a thing IS or DOES, not `data`,
   `temp`, `handle2`, `x`. A reader should not have to run the code to learn what it means.
2. **Is it easy to debug?** Failures are loud, specific, and name the offending value. No silent
   `catch {}`. No error message that says only "something went wrong". Logs must let you locate
   the fault without a debugger attached.
3. **Is it easy to change when a new requirement lands?** Business rules live in one place, not
   smeared across five files. Adding the second variant of something must not require editing
   the first.
4. **Is there unnecessary duplication?** Duplicated *logic* is a bug waiting to be half-fixed.
   (Duplicated *shape* that is coincidental is fine — do not over-abstract to avoid it.)

Also required:
- Comments explain **why**, never **what**. The code already says what.
- Match the surrounding file's style, naming, and comment density. Consistency beats personal taste.
- Dead code, commented-out blocks, and unused exports get deleted, not left "just in case".
  Git remembers; the file should not.
- Public functions, exported types, and non-obvious invariants get a short doc comment.

## 2. EFFICIENT — does the job without wasting resources

Efficient means: do what is needed, and not more. Consider every axis, not just speed:
**time, memory, database queries, network requests, CPU, and scalability.**

Hard rules:
- **Never fetch more than you need.** If the screen shows 10 rows, do not `SELECT` 500,000 and
  filter in application code. Filter, paginate, and project columns in the query.
- **No N+1 queries.** Loading a list and then querying once per row is a defect, not a style
  choice. Join, batch, or preload.
- **Index what you filter, sort, and join on.** A query plan that seq-scans a growing table is a
  future outage.
- **Do not pick the slower algorithm because it was easier to type.** If a better-known approach
  exists for the shape of the data, use it — and say why in a comment when the choice is subtle.
- **Ask what happens at 100x.** Works-at-10-rows and dies-at-1M-rows is a defect with a delayed
  fuse. State the expected scale; design for one order of magnitude beyond it.
- Do not micro-optimize what is not hot. Efficiency is about avoiding waste, not about clever
  tricks that cost readability. When the two conflict, measure before trading away clarity.

## 3. AI-GENERATED CODE IS NOT EXEMPT — it is the highest-risk code in the repo

AI can produce code that **looks** clean: tidy formatting, plausible names, confident structure.
Looking clean and being correct are unrelated properties. Generated code is the code most likely
to be merged unread.

Therefore, before accepting ANY generated block — including your own output:

- Is it actually efficient, or only tidy?
- Is it secure? (See the security and idempotency/concurrency rules; they are not optional.)
- Does it scale?
- Is it maintainable by someone who did not see the prompt?
- **Is the approach even right?** A well-written implementation of the wrong design is worse than
  messy code that is correctly shaped, because it is more convincing.
- Does it invent APIs, fields, or behaviour that were never verified against the real source?
  Check the actual schema, the actual docs, the actual types — never the plausible-sounding guess.

"It works" is the beginning of review, not the end of it. Never present passing output as proof
of quality; run the thing, read the diff, and try to break it before calling it done.

The review to run, on generated and hand-written code alike:

> Review this code for readability, maintainability, performance, security, unnecessary
> complexity, and scalability. Explain what should be improved and why.

Then actually read the answer, test it, and challenge it. Understanding why the code is the way
it is — being able to debug, evaluate and improve it — is the skill. Generating it is not.

## 4. Definition of done

A change is done when ALL of these are true:

- [ ] It works — demonstrated by running it, with the real output quoted, not assumed.
- [ ] It has tests covering the behaviour, including the failure path and edge cases.
- [ ] Names, structure, and comments would survive a stranger's code review.
- [ ] No N+1s, no unbounded queries, no unbounded retries, no unbounded memory growth.
- [ ] Errors are handled explicitly and fail closed; nothing is silently swallowed.
- [ ] No secrets, tokens, or PII in code, logs, responses, or fixtures.
- [ ] Docs/comments updated where behaviour changed; project memory updated where a rule changed.
- [ ] You can explain every line you are shipping. If you cannot explain it, do not ship it.
