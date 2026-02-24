
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { createClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { ConversationTurn } from './state';

const SUPABASE_URL = 'https://gkaszpjcfdkehoivihju.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrYXN6cGpjZmRrZWhvaXZpaGp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MjQwMjMsImV4cCI6MjA3NTMwMDAyM30.u0dxNr1LbH31OmlT7KzloKI6V_k-8uWOCslg3PE9UYw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
export const updateUserSettings = async (userId: string, newSettings: Partial<{ systemPrompt: string; voice: string }>) => {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, ...newSettings });
  if (error) console.error('Error saving settings:', error);
  return Promise.resolve();
};

export const fetchUserConversations = async (userId: string): Promise<ConversationTurn[]> => {
  const { data, error } = await supabase
    .from('translations')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('Error fetching history:', error);
    return [];
  }

  return data.map(item => ({
    timestamp: new Date(item.timestamp),
    role: item.role,
    text: item.text,
    isFinal: true
  }));
};

export const updateUserConversations = async (userId: string, turns: ConversationTurn[]) => {
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || !lastTurn.isFinal) return;

  const { error } = await supabase
    .from('translations')
    .insert({
      user_id: userId,
      role: lastTurn.role,
      text: lastTurn.text,
      timestamp: lastTurn.timestamp.toISOString(),
    });

  if (error) {
    console.error('Error saving turn to Supabase:', error);
  }
};

export const clearUserConversations = async (userId: string) => {
  const { error } = await supabase
    .from('translations')
    .delete()
    .eq('user_id', userId);
  if (error) console.error('Error clearing history:', error);
};
