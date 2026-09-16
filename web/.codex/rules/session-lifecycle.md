# Session lifecycle

The API must enforce server-side absolute and idle session expiry, explicit revocation,
and a per-user concurrent-session cap whose check and registration are serialized.
Clerk authenticates identity; Drezivo authorizes current local tenant membership and branch scope.
Until these controls are implemented and tested, protected business routes must fail closed.
Clients do not grant permissions from UI state, roles sent by the browser, or tenant headers.
