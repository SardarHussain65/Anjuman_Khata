import { ConflictPolicy } from './registry';

export interface FieldMergeInput<T extends Record<string, unknown>> {
  policy: ConflictPolicy;
  serverRecord: T & { version: number; deleted_at?: string | null };
  localPatch: Partial<T>;
  changedFields: string[];
  baseVersion: number;
  isSoftDelete?: boolean;
}

export interface FieldMergeOutcome<T extends Record<string, unknown>> {
  resolution: 'accepted' | 'conflict_merged' | 'conflict_server_wins';
  merged: T;
  loserFields: Record<string, unknown> | null;
}

/**
 * Pure client-side mirror of the Postgres push_changes() conflict resolution rules.
 * Used for deterministic testing and optimistic reconciliation.
 */
export function resolveConflict<T extends Record<string, unknown>>(
  input: FieldMergeInput<T>,
): FieldMergeOutcome<T> {
  const { policy, serverRecord, localPatch, changedFields, baseVersion, isSoftDelete } = input;
  const hasVersionConflict = baseVersion > 0 && serverRecord.version > baseVersion;

  // Rule 1: Config tables -> Server always wins on version mismatch
  if (policy === 'server_wins' && hasVersionConflict) {
    return {
      resolution: 'conflict_server_wins',
      merged: { ...serverRecord },
      loserFields: { ...localPatch },
    };
  }

  // Rule 2: Soft delete always wins over a concurrent edit
  if (!isSoftDelete && serverRecord.deleted_at) {
    return {
      resolution: 'conflict_server_wins',
      merged: { ...serverRecord },
      loserFields: { ...localPatch },
    };
  }

  // Rule 3: Field-level merge for ledger & mutable records
  const merged = { ...serverRecord };
  const loserFields: Record<string, unknown> = {};

  for (const field of changedFields) {
    if (!(field in localPatch)) continue;
    const prevServerVal = serverRecord[field];
    const nextLocalVal = localPatch[field];
    if (hasVersionConflict && prevServerVal !== nextLocalVal) {
      loserFields[field] = prevServerVal;
    }
    (merged as Record<string, unknown>)[field] = nextLocalVal;
  }

  const hadOverlap = hasVersionConflict && Object.keys(loserFields).length > 0;
  return {
    resolution: hadOverlap ? 'conflict_merged' : 'accepted',
    merged,
    loserFields: hadOverlap ? loserFields : null,
  };
}

/** Maps Postgres/RPC rejection codes to user-friendly i18n keys. */
export function mapQuarantineErrorKey(code: string): string {
  switch (code) {
    case 'YEAR_CLOSED':
      return 'sync.reasonYearClosed';
    case 'FORBIDDEN':
      return 'sync.reasonForbidden';
    default:
      return 'sync.reasonValidation';
  }
}
