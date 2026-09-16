# Root safety rules

- Validate at every boundary and use parameterized queries.
- Recompute money, quantities, roles, and tenant scope on the server.
- Make every mutation duplicate-safe; test sequential and concurrent double-fire behavior.
- Reject unknown routes, enums, and states; fail closed.
- Never log secrets, tokens, request bodies, or private evidence.
- Use an outbox or lease-based queue for crash-surviving side effects.
- Enforce absolute and idle session expiry, revocation, and serialized per-user session caps.
