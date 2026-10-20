-- Let the operator console's SECURITY DEFINER functions find pgcrypto's digest().
--
-- 0085 and 0086 pin `search_path = pg_catalog, public` and call digest() unqualified. Supabase
-- installs pgcrypto in the `extensions` schema, so on the hosted databases every call failed with
-- 42883 "function digest(unknown, unknown) does not exist": all support-grant, job-retry and
-- notification-retry commands, every operator workspace operation (digest runs in its DECLARE),
-- and the clothing delete preview. Local and CI Postgres install pgcrypto in `public`, which hid it.
--
-- `extensions` goes last, after the schemas these functions already trust, so nothing it holds
-- can shadow a public or catalog name. Where the schema does not exist the entry is ignored.
ALTER FUNCTION public.operator_console_command(text, text, text, text, jsonb)
  SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.operator_workspace(text, text, uuid, uuid, text, text, jsonb)
  SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.operator_clothing_delete_preview(uuid, uuid)
  SET search_path = pg_catalog, public, extensions;
