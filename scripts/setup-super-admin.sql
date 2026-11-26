-- =============================================================================
-- Anjuman Khata — Provision Super Admin Account
-- =============================================================================
-- Run this ONCE in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- (Run AFTER pushing migration 20261126000010_super_admin_role.sql, or anytime.)
--
-- Creates/promotes:
--   Email:    mashrabhamdaniya@anjuman.com
--   Password: 786bordas  (modifiable anytime from inside the app -> More -> Change Password)
--   Role:     super_admin
--
-- Preserves existing admin accounts (e.g. aslam@gmail.com) as normal `admin`,
-- which you can manage, reset, or revoke directly inside the app!
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure super_admin role is allowed even if migration was not pushed yet
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'super_admin'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_profiles_member_no_required_for_users;

ALTER TABLE public.profiles
  ADD CONSTRAINT chk_profiles_member_no_required_for_users
  CHECK (role IN ('admin', 'super_admin') OR member_no IS NOT NULL);

DO $$
DECLARE
  v_email text := 'mashrabhamdaniya@anjuman.com';
  v_password text := '786bordas';
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Super Admin"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email',
      now(),
      now(),
      now()
    );
  ELSE
    -- Update password & ensure confirmed
    UPDATE auth.users
    SET
      encrypted_password = crypt(v_password, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      banned_until = NULL,
      updated_at = now()
    WHERE id = v_user_id;
  END IF;

  INSERT INTO public.profiles (
    id,
    member_no,
    full_name,
    full_name_ur,
    status,
    role,
    joined_on
  )
  VALUES (
    v_user_id,
    NULL,
    'Mashrab Hamdaniya',
    'مشرب ہمدانیہ',
    'active',
    'super_admin',
    (now() AT TIME ZONE 'Asia/Karachi')::date
  )
  ON CONFLICT (id) DO UPDATE
  SET
    member_no = NULL,
    role = 'super_admin',
    status = 'active',
    deleted_at = NULL;
END $$;

COMMIT;

-- Verify admin & super_admin accounts
SELECT p.id, u.email, p.full_name, p.role, p.status
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role IN ('admin', 'super_admin')
  AND p.deleted_at IS NULL
ORDER BY (p.role = 'super_admin') DESC, p.created_at ASC;
