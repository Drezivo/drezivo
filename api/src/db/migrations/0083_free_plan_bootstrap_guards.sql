-- Free workspace creation does not depend on lifetime paid-trial eligibility.
-- Keep the pre-tenant helpers limited to the authenticated account and an open onboarding.

ALTER POLICY tenant_bootstrap_insert ON public.tenant
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND current_setting('app.actor_kind', true) = 'account'
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.clerk_org_id = tenant.clerk_org_id
         AND o.status IN ('incomplete', 'payment_pending')
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND (a.trial_consumed_at IS NULL OR o.selected_plan_code = 'free')
         AND a.current_owned_tenant_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.bootstrap_slug_available(candidate_slug text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    current_setting('app.actor_kind', true) = 'account'
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.status = 'incomplete'
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND (a.trial_consumed_at IS NULL OR o.selected_plan_code = 'free')
         AND a.current_owned_tenant_id IS NULL
    )
    AND NOT EXISTS (SELECT 1 FROM public.tenant WHERE slug = candidate_slug)
    AND NOT EXISTS (SELECT 1 FROM public.storefront WHERE slug = candidate_slug)
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_clerk_org_available(candidate_clerk_org_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    current_setting('app.actor_kind', true) = 'account'
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.organization_onboarding o
        JOIN public.account a ON a.id = o.account_id
       WHERE o.clerk_org_id = candidate_clerk_org_id
         AND o.status IN ('incomplete', 'payment_pending')
         AND o.provisioned_tenant_id IS NULL
         AND a.clerk_user_id = NULLIF(current_setting('app.principal_id', true), '')
         AND (a.trial_consumed_at IS NULL OR o.selected_plan_code = 'free')
         AND a.current_owned_tenant_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant WHERE clerk_org_id = candidate_clerk_org_id
    )
$$;
