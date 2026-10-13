# Clerk verification email template

The versioned Clerk/Revolvapp source is [`templates/verification-code-v1.html`](templates/verification-code-v1.html).
It changes presentation only. Keep the current subject (`{{otp_code}} is your verification code`),
the existing wording, and Clerk's **Delivered by Clerk** setting unchanged. The body uses the live
Development instance's verified variables: `{{otp_code}}`, `{{requested_from}}`,
`{{requested_at}}`, `{{current_year}}`, `{{app.name}}`, and the `{{> app_logo}}` partial. Do not
add marketing content or alter delivery behavior.

## Preview and apply per environment

Template settings belong to an individual Clerk instance. For this task, update and verify
**Development only**. Do not copy the template to Staging or Production.

1. In the Development Clerk Dashboard, open **Emails**, then **Verification code**.
2. Leave the name, sender, reply-to, subject, and **Delivered by Clerk** setting unchanged.
3. Switch the body editor to HTML mode and replace only the body with the versioned source. The
   source uses Clerk's Revolvapp markup and the variables verified in the Development editor.
4. Use **Preview** to check desktop and mobile. Confirm the verification code appears once, all
   existing warning/request-context copy remains, and the light cream/tan design is legible.
5. Send a test message only to an explicitly authorized recipient. Confirm the received message
   retains the existing subject, wording, code, and request-context details. If the recipient
   inbox cannot be inspected, record that limitation rather than treating the send request as
   delivery verification.
6. Record the Development template revision below. Keep Staging unchanged; Production is gated by
   counsel review and launch approval.

Clerk's editor supports Handlebars variables, Preview, and template copying between instances:
[Email and SMS templates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates).
This repository source does not update a Clerk Dashboard instance by itself.

## Development change record

- Date: 2026-10-14
- Instance: Drezivo / Development
- Template: Verification code (`verification_code`)
- Revision: saved 2026-10-14; the Development editor showed **Last updated just now** and provides no
  numeric revision identifier. Final layout uses a 400px content container with 8px outer mobile
  padding.
- Subject and Clerk delivery setting: unchanged
- Staging and Production: not changed
- Preview: Drezivo branding, sample code `123456`, and the full existing security/request-context
  copy render in Clerk's desktop preview and mobile editor view. The desktop preview frame showed a
  horizontal scrollbar; the narrower layout was saved to improve fit, but a final scrollbar-free
  desktop preview was not confirmed.
- Real test email: a verification email was requested for the explicitly authorized
  `drezivoshop@gmail.com` address; the local sign-in flow confirmed “Code sent”. The connected Gmail
  account is `romeroryannym@gmail.com`, so receipt, inbox rendering, and successful code use could not
  be verified. No code was accessed or entered.

## Release gate

The legal-document index remains marked `counsel-review`. Do not apply this feature to the
Production Clerk instance or release signup consent changes to Production until the Terms of
Service and related data-flow disclosures have cleared the existing counsel/DPO review and launch
approval. Styling the verification email does not guarantee inbox placement.
