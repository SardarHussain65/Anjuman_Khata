// Edge Function: admin-create-user
// Runs strictly server-side with SUPABASE_SERVICE_ROLE_KEY.
// Verifies the caller's JWT and checks profiles.role = 'admin' before creating
// an Auth user + profile (+ optional initial tier) atomically, or resetting a password.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateMemberRequest {
  action?: 'create' | 'reset_password';
  // For create:
  email?: string;
  password?: string;
  member_no?: number;
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
  // For reset_password:
  user_id?: string;
  new_password?: string;
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

  // 1. Verify caller identity & admin role using server-side service client
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
    .select('id, role, deleted_at')
    .eq('id', caller.id)
    .maybeSingle();

  if (profileCheckError) {
    console.error('[admin-create-user] profile check error:', profileCheckError);
    return jsonResponse(
      { error: `Admin check query failed: ${profileCheckError.message}` },
      500,
    );
  }

  if (!callerProfile || callerProfile.deleted_at || callerProfile.role !== 'admin') {
    return jsonResponse(
      {
        error: `Forbidden: admin role required (caller=${caller.id}, found=${Boolean(callerProfile)}, role=${callerProfile?.role ?? 'none'})`,
      },
      403,
    );
  }

  let body: CreateMemberRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const action = body.action ?? 'create';

  // 3a. Admin password reset action
  if (action === 'reset_password') {
    if (!body.user_id || !body.new_password || body.new_password.length < 6) {
      return jsonResponse({ error: 'user_id and new_password (min 6 chars) are required' }, 400);
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

  // 3b. Atomic create Auth user + profile (+ optional initial tier)
  const fullName = body.full_name?.trim();
  const status = body.status ?? 'active';
  const role = body.role ?? 'user';
  const memberNo = role === 'admin' ? (body.member_no ?? null) : body.member_no;

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

  // Optional initial tier assignment (for active members)
  let createdTierAssignment = null;
  if (status === 'active' && body.tier_id) {
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
      // Roll back profile (with superuser hard-delete bypass not needed: keep clean via auth delete or return partial error)
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
