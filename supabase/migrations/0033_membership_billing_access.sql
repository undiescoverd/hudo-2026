-- ============================================================
-- 0033_membership_billing_access.sql  (S5-ADMIN-001, GH #207)
--
-- Billing stays owner-only by default. The owner may grant billing access to
-- an individual admin_agent; the grant lives on the membership, not in a new
-- role, so access is still derived from `memberships` like every other check.
--
--   memberships.can_manage_billing boolean NOT NULL DEFAULT false
--
-- A granted admin_agent may view the plan/invoices and change the payment
-- method (Stripe portal). Plan change and cancel remain owner-only; that is
-- enforced in the API routes, not here.
--
-- RLS: no policy change. memberships has a SELECT policy only (0002/0003), so
-- no authenticated/anon client can INSERT/UPDATE/DELETE a membership; the
-- column is written by the service-role API route alone. The trigger below is
-- defence in depth so that a future UPDATE/INSERT policy on memberships can
-- never let a client self-grant billing access, and so the flag can never
-- outlive the admin_agent role.
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ============================================================

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS can_manage_billing boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_membership_billing_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Client roles (PostgREST JWT roles) may never set or change the flag.
  -- postgres / service_role (server API routes, migrations) are unaffected.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' AND NEW.can_manage_billing THEN
      RAISE EXCEPTION 'can_manage_billing can only be set by the server'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.can_manage_billing IS DISTINCT FROM OLD.can_manage_billing THEN
      RAISE EXCEPTION 'can_manage_billing can only be changed by the server'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The flag is only meaningful on an admin_agent: demotion/promotion clears it.
  IF NEW.role <> 'admin_agent' THEN
    NEW.can_manage_billing := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_membership_billing_access ON memberships;
CREATE TRIGGER guard_membership_billing_access
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION guard_membership_billing_access();
