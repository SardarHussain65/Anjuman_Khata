import { supabase } from './supabaseClient';
import { MemberStatus, ProfileRow, MemberTierRow } from '../db/types';
import { UserRole } from '@/core/permissions';

export interface AdminCreateMemberPayload {
  email?: string;
  password?: string;
  member_no?: number | null;
  full_name: string;
  full_name_ur?: string | null;
  phone?: string | null;
  designation?: string | null;
  tag?: string | null;
  status: MemberStatus;
  role: 'user' | 'admin';
  personal_pledge?: number | null;
  joined_on?: string;
  notes?: string | null;
  tier_id?: string | null;
  effective_from?: string | null;
  tier_reason?: string | null;
}

export interface AdminCreateMemberResult {
  profile: ProfileRow;
  member_tier: MemberTierRow | null;
  login_email: string;
}

export interface ManagedAdminAccount {
  id: string;
  full_name: string;
  full_name_ur: string | null;
  phone: string | null;
  email: string;
  role: UserRole;
  status: MemberStatus;
  created_at: string;
}

async function extractEdgeError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: string; message?: string };
        if (body?.error) return body.error;
        if (body?.message) return body.message;
      } catch {
        // Ignore non-JSON body
      }
    }
  }
  return error instanceof Error ? error.message : 'Unable to complete admin request';
}

async function invokeAdminEdge<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body,
  });
  if (error) {
    throw new Error(await extractEdgeError(error));
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data as T;
}

export async function invokeAdminCreateMember(
  payload: AdminCreateMemberPayload,
): Promise<AdminCreateMemberResult> {
  return invokeAdminEdge<AdminCreateMemberResult>({ action: 'create', ...payload });
}

export async function invokeAdminResetPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await invokeAdminEdge<{ ok: boolean }>({
    action: 'reset_password',
    user_id: userId,
    new_password: newPassword,
  });
}

export async function invokeListAdmins(): Promise<ManagedAdminAccount[]> {
  const res = await invokeAdminEdge<{ admins: ManagedAdminAccount[] }>({
    action: 'list_admins',
  });
  return res.admins ?? [];
}

export async function invokeCreateAdminAccount(payload: {
  full_name: string;
  email: string;
  password: string;
  phone?: string | null;
}): Promise<AdminCreateMemberResult> {
  return invokeAdminEdge<AdminCreateMemberResult>({
    action: 'create',
    role: 'admin',
    status: 'active',
    full_name: payload.full_name.trim(),
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    phone: payload.phone?.trim() || null,
  });
}

export async function invokeSetAdminStatus(
  userId: string,
  isActive: boolean,
): Promise<void> {
  await invokeAdminEdge<{ ok: boolean }>({
    action: 'set_admin_status',
    user_id: userId,
    is_active: isActive,
  });
}

/**
 * Updates the currently signed-in admin or super_admin's own password via Supabase Auth.
 */
export async function updateOwnPassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    throw new Error(error.message);
  }
}
