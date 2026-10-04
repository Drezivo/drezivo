-- Storefront email addresses remain contact details, but are no longer verified or emailed.
-- Cancel unsent customer-directed messages and erase their sealed payloads before dropping the
-- verification store. Business/owner-directed notification rows are intentionally untouched.
UPDATE outbox_event
   SET status = 'dead',
       payload = '{}'::jsonb,
       lease_token = NULL,
       lease_until = NULL,
       completed_at = now(),
       safe_last_error = 'Guest customer email is no longer sent.'
 WHERE event_type = 'notification.email'
   AND status IN ('pending', 'leased')
   AND (
     dedupe_key LIKE 'guest-verification:%'
     OR dedupe_key LIKE 'reservation-email:%:customer'
     OR dedupe_key LIKE 'fitting-email:%:customer'
   );

DROP TABLE guest_email_verification;
