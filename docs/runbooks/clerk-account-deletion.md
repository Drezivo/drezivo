# Clerk account deletion controls

The partners Security page directs account deletion requests to Drezivo support. The message is not an enforcement control: Clerk must reject self-deletion at its Frontend API as well as remove its delete action. A Clerk instance can be shared across surfaces, so confirm which applications use it before changing its settings. The application and production setting require the normal reviewed release process.

## Staging checklist

- [ ] Identify the Clerk instance used by the staging partners app and the surfaces that share it. Do not change production while performing staging verification.
- [x] In the Clerk Dashboard, open **User & authentication → User model → User permissions** and turn off **Allow users to delete their accounts**. Save the setting if prompted. The user reported this was turned off for staging/development; independent verification is pending.
- [ ] Inspect the effective `deleteSelfEnabled` permission for existing users, including any individual overrides. Resolve any exceptions through an approved, auditable provider-admin process; do not assume changing the instance default removed all overrides.
- [ ] With a dedicated disposable test identity, verify the account page has no Clerk delete action and a direct authenticated Clerk Frontend API self-deletion request is rejected. Confirm the test identity still exists. Never perform a deletion test using a real user.
- [ ] Confirm the Security page shows the support email and that password, two-step verification, and session management remain available. Verify the message is absent on Profile.

## Production checklist

- [ ] After staging verification and release approval, identify the production Clerk instance and confirm its shared surfaces.
- [ ] Turn off self-service deletion in the production instance and audit effective per-user permissions, including overrides.
- [ ] Verify using a designated disposable production test identity; confirm rejection and that the identity remains intact. Never test deletion against a real user.
- [ ] Confirm the support contact on the deployed Security page and record the verification results without credentials or personal data.

Support handles requests after verifying the requester and following the applicable retention and deletion process. Disabling self-service does not itself delete an account, business records, or backups. Provider-side administrative deletion remains an authorized support operation.

References: [Clerk user model](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options#user-model), [Clerk user permissions](https://clerk.com/docs/reference/backend/types/backend-user), and [Drezivo retention and deletion standard](../product/legal/Drezivo-Data-Retention-and-Deletion-Standard.md).
