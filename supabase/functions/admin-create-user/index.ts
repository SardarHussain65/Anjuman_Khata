// Edge Function: admin-create-user
// Runs strictly server-side with SUPABASE_SERVICE_ROLE_KEY.
// Verifies the caller's JWT and checks profiles.role in ('admin', 'super_admin'):
//   - Any active admin/super_admin can create regular ('user') members or reset their own password.
//   - ONLY active 'super_admin' can list admins, create new 'admin' accounts,
//     reset another admin's password, or revoke/restore an admin account.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AdminEdgeRequest {
  action?: 'create' | 'reset_password' | 'list_admins' | 'set_admin_status';
  // For create:
  email?: string;
  password?: string;
  member_no?: number | null;
  full_name?: string;
  full_name_ur?: string | null;
  phone?: string | null;
  designation?: string | null;
  tag?: string | null;
  status?: 'active' | 'non_earning' | 'inactive';
  role?: 'user' | 'admin';
  personal_pledge?: number | null;
  joined_on?: string;
  notes?: string | null;
  tier_id?: string | null;
  effective_from?: string | null;
  tier_reason?: string | null;
  // For reset_password / set_admin_status:
  user_id?: string;
  new_password?: string;
  is_active?: boolean;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration incomplete' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 1. Verify caller identity & active admin/super_admin role using server-side service client
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(serviceRoleKey.startsWith('eyJ')
      ? { global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } } }
      : {}),
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await adminClient.auth.getUser(token);

  if (callerError || !caller) {
    return jsonResponse({ error: callerError?.message ?? 'Invalid or expired session' }, 401);
  }

  const { data: callerProfile, error: profileCheckError } = await adminClient
    .from('profiles')
    .select('id, role, status, deleted_at')
    .eq('id', caller.id)
    .maybeSingle();

  if (profileCheckError) {
    console.error('[admin-create-user] profile check error:', profileCheckError);
    return jsonResponse(
      { error: `Admin check query failed: ${profileCheckError.message}` },
      500,
    );
  }

  const isCallerSuperAdmin =
    Boolean(callerProfile) &&
    !callerProfile?.deleted_at &&
    callerProfile?.status === 'active' &&
    callerProfile?.role === 'super_admin';

  const isCallerAdmin =
    isCallerSuperAdmin ||
    (Boolean(callerProfile) &&
      !callerProfile?.deleted_at &&
      callerProfile?.status === 'active' &&
      callerProfile?.role === 'admin');

  if (!isCallerAdmin) {
    return jsonResponse(
      {
        error: `Forbidden: active admin role required (caller=${caller.id}, role=${callerProfile?.role ?? 'none'})`,
      },
      403,
    );
  }

  let body: AdminEdgeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const action = body.action ?? 'create';

  // 2a. List all admins & super_admins (Super Admin only)
  if (action === 'list_admins') {
    if (!isCallerSuperAdmin) {
      return jsonResponse({ error: 'Forbidden: super_admin role required' }, 403);
    }

    const { data: adminProfiles, error: listErr } = await adminClient
      .from('profiles')
      .select('id, full_name, full_name_ur, phone, role, status, created_at')
      .in('role', ['admin', 'super_admin'])
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (listErr) {
      return jsonResponse({ error: listErr.message }, 500);
    }

    const { data: authUsersData } = await adminClient.auth.admin.listUsers({ perPage: 200 });
    const emailById = new Map<string, string>();
    for (const u of authUsersData?.users ?? []) {
      if (u.email) emailById.set(u.id, u.email);
    }

    const admins = (adminProfiles ?? []).map((p) => ({
      ...p,
      email: emailById.get(p.id) ?? '',
    }));

    return jsonResponse({ admins });
  }

  // 2b. Revoke or re-enable an admin account (Super Admin only)
  if (action === 'set_admin_status') {
    if (!isCallerSuperAdmin) {
      return jsonResponse({ error: 'Forbidden: super_admin role required' }, 403);
    }

    if (!body.user_id || typeof body.is_active !== 'boolean') {
      return jsonResponse({ error: 'user_id and is_active (boolean) are required' }, 400);
    }

    if (body.user_id === caller.id) {
      return jsonResponse({ error: 'You cannot revoke your own Super Admin account' }, 400);
    }

    const { data: targetProfile, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, role, status')
      .eq('id', body.user_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return jsonResponse({ error: 'Target admin account not found' }, 404);
    }

    if (targetProfile.role === 'super_admin') {
      return jsonResponse({ error: 'Super Admin accounts cannot be revoked here' }, 403);
    }

    const nextStatus = body.is_active ? 'active' : 'inactive';

    const { error: banErr } = await adminClient.auth.admin.updateUserById(body.user_id, {
      ban_duration: body.is_active ? 'none' : '876000h',
    });

    if (banErr) {
      return jsonResponse({ error: banErr.message }, 400);
    }

    const { error: updateErr } = await adminClient
      .from('profiles')
      .update({ status: nextStatus, updated_by: caller.id })
      .eq('id', body.user_id);

    if (updateErr) {
      return jsonResponse({ error: updateErr.message }, 400);
    }

    await adminClient.from('audit_log').insert({
      actor_id: caller.id,
      action: body.is_active ? 'SUPER_ADMIN_ENABLE_ADMIN' : 'SUPER_ADMIN_REVOKE_ADMIN',
      table_name: 'profiles',
      record_id: body.user_id,
      old_data: { status: targetProfile.status },
      new_data: { status: nextStatus },
    });

    return jsonResponse({ ok: true, user_id: body.user_id, status: nextStatus });
  }

  // 2c. Password reset action
  if (action === 'reset_password') {
    if (!body.user_id || !body.new_password || body.new_password.length < 6) {
      return jsonResponse({ error: 'user_id and new_password (min 6 chars) are required' }, 400);
    }

    // Normal admins can only reset their own password or non-admin users;
    // resetting another admin's password requires super_admin.
    if (body.user_id !== caller.id && !isCallerSuperAdmin) {
      const { data: targetProfile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', body.user_id)
        .maybeSingle();

      if (targetProfile?.role === 'admin' || targetProfile?.role === 'super_admin') {
        return jsonResponse(
          { error: 'Forbidden: only Super Admin can reset another admin password' },
          403,
        );
      }
    }

    const { error: resetError } = await adminClient.auth.admin.updateUserById(body.user_id, {
      password: body.new_password,
    });

    if (resetError) {
      return jsonResponse({ error: resetError.message }, 400);
    }

    await adminClient.from('audit_log').insert({
      actor_id: caller.id,
      action: 'ADMIN_RESET_PASSWORD',
      table_name: 'profiles',
      record_id: body.user_id,
      old_data: null,
      new_data: { target_user_id: body.user_id },
    });

    return jsonResponse({ ok: true, user_id: body.user_id });
  }

  // 2d. Atomic create Auth user + profile (+ optional initial tier)
  const fullName = body.full_name?.trim();
  const status = body.status ?? 'active';
  const role = body.role ?? 'user';

  if (role === 'admin' && !isCallerSuperAdmin) {
    return jsonResponse({ error: 'Forbidden: only Super Admin can create new Admins' }, 403);
  }

  const memberNo = role === 'admin' ? null : body.member_no;

  if (!fullName) {
    return jsonResponse({ error: 'full_name is required' }, 400);
  }

  if (role !== 'admin' && (!Number.isInteger(memberNo) || (memberNo ?? 0) <= 0)) {
    return jsonResponse({ error: 'positive integer member_no is required for members' }, 400);
  }

  if (memberNo != null && (!Number.isInteger(memberNo) || memberNo <= 0)) {
    return jsonResponse({ error: 'member_no must be a positive integer when provided' }, 400);
  }

  if (!['active', 'non_earning', 'inactive'].includes(status)) {
    return jsonResponse({ error: 'Invalid member status' }, 400);
  }

  if (!['user', 'admin'].includes(role)) {
    return jsonResponse({ error: 'Invalid role' }, 400);
  }

  if (role === 'admin' && (!body.email?.trim() || !body.password || body.password.length < 6)) {
    return jsonResponse({ error: 'Email and password (min 6 chars) are required for an Admin account' }, 400);
  }

  if (body.personal_pledge != null && (!Number.isInteger(body.personal_pledge) || body.personal_pledge <= 0)) {
    return jsonResponse({ error: 'personal_pledge must be a positive integer PKR amount' }, 400);
  }

  const email =
    body.email?.trim().toLowerCase() ||
    (memberNo != null ? `member${memberNo}@anjumankhata.app` : `admin-${crypto.randomUUID().slice(0, 8)}@anjumankhata.app`);
  const password = body.password && body.password.length >= 6
    ? body.password
    : crypto.randomUUID().replace(/-/g, '').slice(0, 14);

  // Create Auth user first
  const { data: createdAuth, error: authCreateError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, member_no: memberNo },
  });

  if (authCreateError || !createdAuth.user) {
    return jsonResponse({ error: authCreateError?.message ?? 'Failed to create auth user' }, 400);
  }

  const newUserId = createdAuth.user.id;

  // Insert profile atomically; rollback Auth user if profile insert fails
  const profileRow = {
    id: newUserId,
    member_no: memberNo,
    full_name: fullName,
    full_name_ur: body.full_name_ur ?? null,
    phone: body.phone ?? null,
    designation: body.designation ?? null,
    tag: body.tag ?? null,
    status,
    role,
    personal_pledge: body.personal_pledge ?? null,
    joined_on: body.joined_on ?? new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10),
    notes: body.notes ?? null,
    updated_by: caller.id,
  };

  const { data: createdProfile, error: profileInsertError } = await adminClient
    .from('profiles')
    .insert(profileRow)
    .select('*')
    .single();

  if (profileInsertError || !createdProfile) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return jsonResponse(
      { error: profileInsertError?.message ?? 'Failed to create member profile' },
      400,
    );
  }

  if (role === 'admin') {
    await adminClient.from('audit_log').insert({
      actor_id: caller.id,
      action: 'SUPER_ADMIN_CREATE_ADMIN',
      table_name: 'profiles',
      record_id: newUserId,
      old_data: null,
      new_data: { full_name: fullName, email, role: 'admin' },
    });
  }

  // Optional initial tier assignment (for active members)
  let createdTierAssignment = null;
  if (role !== 'admin' && status === 'active' && body.tier_id) {
    const { data: tierRow, error: tierError } = await adminClient
      .from('member_tiers')
      .insert({
        member_id: newUserId,
        tier_id: body.tier_id,
        effective_from: body.effective_from ?? profileRow.joined_on,
        reason: body.tier_reason ?? 'Initial tier assignment',
        updated_by: caller.id,
      })
      .select('*')
      .single();

    if (tierError) {
      return jsonResponse(
        {
          error: `Profile created, but tier assignment failed: ${tierError.message}`,
          profile: createdProfile,
        },
        400,
      );
    }
    createdTierAssignment = tierRow;
  }

  return jsonResponse(
    {
      profile: createdProfile,
      member_tier: createdTierAssignment,
      login_email: email,
    },
    201,
  );
});
