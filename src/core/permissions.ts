/**
 * UI capability helpers mirroring database RLS policies.
 * NEVER relied on as the sole security boundary — Postgres RLS enforces all access control.
 */

export type UserRole = 'user' | 'admin';

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canWriteLedger(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canManageMembers(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canManageZakat(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canViewAuditLog(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canExportReports(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}
