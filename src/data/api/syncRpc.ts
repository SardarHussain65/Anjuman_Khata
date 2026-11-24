import { supabase } from '../api/supabaseClient';
import { SyncOp, SyncTableName } from '../db/types';

export interface PullChangesResponse {
  server_time: string;
  changes: Partial<Record<SyncTableName, Record<string, unknown>[]>>;
}

export interface PushMutationPayload {
  outbox_id: string;
  table: SyncTableName;
  op: SyncOp;
  record_id: string;
  base_version: number;
  changed_fields: string[];
  payload: Record<string, unknown>;
}

export interface PushMutationResult {
  outbox_id: string;
  table: SyncTableName;
  record_id: string;
  status: 'accepted' | 'conflict_merged' | 'merged' | 'conflict_server_wins' | 'rejected';
  record?: Record<string, unknown>;
  code?: string;
  message?: string;
  error_code?: string;
  error_message?: string;
}

export interface PushChangesResponse {
  server_time: string;
  results: PushMutationResult[];
}

export interface SyncTransport {
  pullChanges(
    lastPulledAt: string | null,
    tables?: SyncTableName[],
  ): Promise<PullChangesResponse>;
  pushChanges(mutations: PushMutationPayload[]): Promise<PushChangesResponse>;
}

const supabaseSyncTransport: SyncTransport = {
  async pullChanges(lastPulledAt, tables) {
    const { data, error } = await supabase.rpc('pull_changes', {
      p_last_pulled_at: lastPulledAt,
      p_tables: tables ?? null,
    });
    if (error) {
      throw new Error(error.message || 'Failed to pull changes from server');
    }
    return data as PullChangesResponse;
  },

  async pushChanges(mutations) {
    const { data, error } = await supabase.rpc('push_changes', {
      p_mutations: mutations,
    });
    if (error) {
      throw new Error(error.message || 'Failed to push changes to server');
    }
    return data as PushChangesResponse;
  },
};

let activeTransport: SyncTransport = supabaseSyncTransport;

export function getSyncTransport(): SyncTransport {
  return activeTransport;
}

export function setSyncTransportForTests(transport: SyncTransport | null): void {
  activeTransport = transport ?? supabaseSyncTransport;
}
