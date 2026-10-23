-- HUDO — create_agency_with_owner (S4-JOURNEY-001)
-- Self-serve sign-up: atomically create the public.users profile, the agency
-- (plain freemium: column defaults for plan / storage limit) and the owner
-- membership in ONE transaction, so a failure can never leave a user without an
-- agency or an agency without an owner.
--
-- Called only from POST /api/auth/register via the service-role admin client.
-- Any failure (e.g. unique_violation 23505 on agencies.slug, a race with another
-- sign-up) raises and rolls the whole function back; the route maps it to 409/500
-- and deletes the just-created auth user.
--
-- Hardened: SECURITY DEFINER + empty search_path (all names schema-qualified),
-- EXECUTE revoked from PUBLIC/anon/authenticated, granted to service_role only.

CREATE OR REPLACE FUNCTION public.create_agency_with_owner(
  p_user_id     uuid,
  p_email       text,
  p_full_name   text,
  p_agency_name text,
  p_slug        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  IF coalesce(btrim(p_agency_name), '') = '' OR coalesce(btrim(p_slug), '') = '' THEN
    RAISE EXCEPTION 'agency name and slug are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.users (id, email, full_name)
  VALUES (p_user_id, lower(btrim(p_email)), btrim(p_full_name));

  INSERT INTO public.agencies (name, slug)
  VALUES (btrim(p_agency_name), p_slug)
  RETURNING id INTO v_agency_id;

  INSERT INTO public.memberships (user_id, agency_id, role)
  VALUES (p_user_id, v_agency_id, 'owner');

  RETURN v_agency_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_agency_with_owner(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_agency_with_owner(uuid, text, text, text, text)
  TO service_role;
