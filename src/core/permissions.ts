/**
 * UI capability helpers mirroring database RLS policies.
 * NEVER relied on as the sole security boundary — Postgres RLS enforces all access control.
 */

export type UserRole = 'user' | 'admin' | 'super_admin';

export function isSuperAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'super_admin';
}

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function canWriteLedger(role: UserRole | null | undefined): boolean {
  return isAdminRole(role);
}

export function canManageMembers(role: UserRole | null | undefined): boolean {
  return isAdminRole(role);
}

export function canManageZakat(role: UserRole | null | undefined): boolean {
  return isAdminRole(role);
}

export function canViewAuditLog(role: UserRole | null | undefined): boolean {
  return isAdminRole(role);
}

export function canExportReports(role: UserRole | null | undefined): boolean {
  return isAdminRole(role);
}

export function canManageAdmins(role: UserRole | null | undefined): boolean {
  return isSuperAdminRole(role);
}
