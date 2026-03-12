
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { createClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { ConversationTurn } from './state';

type PersistenceTable = 'translations' | 'user_settings';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let hasLoggedMissingSupabaseConfig = false;
const DISABLED_TABLES_STORAGE_KEY = 'dualt-disabled-supabase-tables';

const loadDisabledPersistenceTables = (): Set<PersistenceTable> => {
  if (typeof window === 'undefined') {
    return new Set<PersistenceTable>();
  }

  try {
    const raw = window.localStorage.getItem(DISABLED_TABLES_STORAGE_KEY);
    if (!raw) {
      return new Set<PersistenceTable>();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<PersistenceTable>();
    }

    return new Set(
      parsed.filter(
        (value): value is PersistenceTable =>
          value === 'translations' || value === 'user_settings',
      ),
    );
  } catch {
    return new Set<PersistenceTable>();
  }
};

const persistDisabledPersistenceTables = (tables: Set<PersistenceTable>) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      DISABLED_TABLES_STORAGE_KEY,
      JSON.stringify(Array.from(tables)),
    );
  } catch {
    // Ignore storage failures and keep the in-memory fallback.
  }
};

const disabledPersistenceTables = loadDisabledPersistenceTables();
const inFlightConversationFetches = new Map<string, Promise<ConversationTurn[]>>();

export const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  : null;

const getSupabaseClient = () => {
  if (supabase) {
    return supabase;
  }

  if (!hasLoggedMissingSupabaseConfig) {
    console.warn(
      'Supabase is disabled because VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing.'
    );
    hasLoggedMissingSupabaseConfig = true;
  }

  return null;
};

const isMissingPersistenceResourceError = (error: unknown) => {
  const candidate = error as {
    code?: string;
    message?: string;
    details?: string;
    status?: number | string;
    statusCode?: number | string;
  } | null;

  const status = Number(candidate?.status ?? candidate?.statusCode ?? 0);
  const code = candidate?.code ?? '';
  const details = `${candidate?.message ?? ''} ${candidate?.details ?? ''}`.toLowerCase();

  return (
    status === 404 ||
    code === 'PGRST205' ||
    details.includes('could not find') ||
    details.includes('does not exist') ||
    details.includes('not found')
  );
};

const disablePersistenceTable = (table: PersistenceTable) => {
  if (disabledPersistenceTables.has(table)) {
    return;
  }

  disabledPersistenceTables.add(table);
  persistDisabledPersistenceTables(disabledPersistenceTables);
  console.warn(
    `Supabase persistence for "${table}" is disabled because the table or REST endpoint is unavailable.`
  );
};

const canUsePersistenceTable = (table: PersistenceTable) =>
  !disabledPersistenceTables.has(table);

// --- AUTH STORE ---
interface AuthState {
  session: any | null;
  user: { id: string; email: string; } | null;
  isSuperAdmin: boolean;
  loading: boolean;
  loadingData: boolean;
  signInWithId: (id: string) => Promise<void>;
  signOut: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  user: null,
  isSuperAdmin: false,
  loading: false,
  loadingData: false,
  signInWithId: async (id: string) => {
    // Basic validation: SI followed by 4 characters
    const isValid = /^SI.{4}$/.test(id);
    if (!isValid) {
      throw new Error('Invalid ID format. Must start with SI followed by 4 characters.');
    }

    set({
      user: { id, email: `${id}@eburon.ai` },
      session: { id },
      isSuperAdmin: id === 'SI0000', // Example: SI0000 is super admin
    });
  },
  signOut: () => set({ user: null, session: null, isSuperAdmin: false }),
}));

// --- DATABASE HELPERS ---
export const updateUserSettings = async (
  userId: string,
  newSettings: Partial<{ systemPrompt: string; voice1: string; voice2: string }>
) => {
  const client = getSupabaseClient();
  if (!client || !canUsePersistenceTable('user_settings')) return Promise.resolve();

  const { error } = await client
    .from('user_settings')
    .upsert({ user_id: userId, ...newSettings });
  if (error) {
    if (isMissingPersistenceResourceError(error)) {
      disablePersistenceTable('user_settings');
      return Promise.resolve();
    }
    console.error('Error saving settings:', error);
  }
  return Promise.resolve();
};

export const fetchUserConversations = async (userId: string): Promise<ConversationTurn[]> => {
  const client = getSupabaseClient();
  if (!client || !canUsePersistenceTable('translations')) return [];

  const existingRequest = inFlightConversationFetches.get(userId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const { data, error } = await client
      .from('translations')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: true });

    if (error) {
      if (isMissingPersistenceResourceError(error)) {
        disablePersistenceTable('translations');
        return [];
      }
      console.error('Error fetching history:', error);
      return [];
    }

    return data.map(item => ({
      timestamp: new Date(item.timestamp),
      role: item.role,
      text: item.text,
      isFinal: true
    }));
  })();

  inFlightConversationFetches.set(userId, request);

  try {
    return await request;
  } finally {
    inFlightConversationFetches.delete(userId);
  }
};

export const updateUserConversations = async (userId: string, turns: ConversationTurn[]) => {
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || !lastTurn.isFinal) return;

  const client = getSupabaseClient();
  if (!client || !canUsePersistenceTable('translations')) return;

  const { error } = await client
    .from('translations')
    .insert({
      user_id: userId,
      role: lastTurn.role,
      text: lastTurn.text,
      timestamp: lastTurn.timestamp.toISOString(),
    });

  if (error) {
    if (isMissingPersistenceResourceError(error)) {
      disablePersistenceTable('translations');
      return;
    }
    console.error('Error saving turn to Supabase:', error);
  }
};

export const clearUserConversations = async (userId: string) => {
  const client = getSupabaseClient();
  if (!client || !canUsePersistenceTable('translations')) return;

  const { error } = await client
    .from('translations')
    .delete()
    .eq('user_id', userId);
  if (error) {
    if (isMissingPersistenceResourceError(error)) {
      disablePersistenceTable('translations');
      return;
    }
    console.error('Error clearing history:', error);
  }
};
