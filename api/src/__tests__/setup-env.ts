// Test-only defaults for the required invitation protection keys. Production and local
// development still require deployment-managed values through the central config loader.
process.env.INVITATION_EMAIL_ENCRYPTION_KEY ??= Buffer.alloc(32, 17).toString('base64url');
process.env.INVITATION_EMAIL_DIGEST_KEY ??= Buffer.alloc(32, 29).toString('base64url');
