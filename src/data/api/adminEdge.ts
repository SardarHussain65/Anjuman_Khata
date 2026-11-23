import { supabase } from './supabaseClient';
import { MemberStatus, ProfileRow, MemberTierRow } from '../db/types';

export interface AdminCreateMemberPayload {
  email?: string;
  password?: string;
  member_no: number;
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

export async function invokeAdminCreateMember(
  payload: AdminCreateMemberPayload,
): Promise<AdminCreateMemberResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: { action: 'create', ...payload },
  });
  if (error) {
    throw new Error(await extractEdgeError(error));
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  return data as AdminCreateMemberResult;
}

export async function invokeAdminResetPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: {
      action: 'reset_password',
      user_id: userId,
      new_password: newPassword,
    },
  });
  if (error) {
    throw new Error(await extractEdgeError(error));
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
}
