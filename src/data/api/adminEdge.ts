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

export async function invokeAdminCreateMember(
  payload: AdminCreateMemberPayload,
): Promise<AdminCreateMemberResult> {
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body: { action: 'create', ...payload },
  });
  if (error) {
    throw new Error(error.message || 'Unable to create member account');
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
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body: {
      action: 'reset_password',
      user_id: userId,
      new_password: newPassword,
    },
  });
  if (error) {
    throw new Error(error.message || 'Unable to reset password');
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
}
