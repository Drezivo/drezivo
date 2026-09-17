-- TBF-021: retain the owner-supplied organization identity needed to resume onboarding.
ALTER TABLE organization_onboarding
  ADD COLUMN organization_name text NOT NULL DEFAULT 'Unspecified organization',
  ADD COLUMN requested_slug text;

ALTER TABLE organization_onboarding
  ADD CONSTRAINT organization_onboarding_organization_name_length
    CHECK (char_length(organization_name) BETWEEN 1 AND 160),
  ADD CONSTRAINT organization_onboarding_requested_slug_format
    CHECK (
      requested_slug IS NULL OR
      (char_length(requested_slug) BETWEEN 3 AND 100 AND
       requested_slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
    );

COMMENT ON COLUMN organization_onboarding.organization_name IS
  'Owner-supplied business or organization display name; provider identity remains in Clerk.';
COMMENT ON COLUMN organization_onboarding.requested_slug IS
  'Validated requested Clerk organization slug, retained for reconciliation and resume.';
