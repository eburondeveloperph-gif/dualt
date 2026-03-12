/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// cspell:ignore genai

import { create } from 'zustand';
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE_STAFF, DEFAULT_VOICE_GUEST } from './constants';
import {
  FunctionDeclaration,
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
  Type,
} from '@google/genai';

export const declaration: FunctionDeclaration = {
  name: 'report_guest_language',
  description:
    'Report the detected language of the Guest on every Guest utterance before translating. This keeps Staff-to-Guest replies targeted to the correct guest language. Provide the language name in English (e.g., "Tagalog", "Japanese", "Arabic").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      language: {
        type: Type.STRING,
        description: 'The name of the detected language in English.',
      },
    },
    required: ['language'],
  },
};

const generateSystemPrompt = (
  guestLanguage: string,
  staffLanguage: string,
  topic: string,
  lastGuestLanguage?: string,
) => {
  const isAutoGuest = guestLanguage === 'auto';
  const isAutoStaff = staffLanguage === 'auto';

  const normalizedLastGuestLanguage =
    lastGuestLanguage && lastGuestLanguage !== 'none' ? lastGuestLanguage : '';

  const dynamicSessionState = normalizedLastGuestLanguage
    ? `
DYNAMIC SESSION STATE:
- Last Detected Guest Language: ${normalizedLastGuestLanguage}
- Staff responses must be translated into: ${normalizedLastGuestLanguage}
`
    : '';

  let instruction = '';

  if (isAutoGuest && !isAutoStaff) {
    // Standard Mode: Staff language is fixed, Guest language is auto-detected
    instruction = `
${dynamicSessionState}
ROLE IDENTIFICATION & CONTEXT:
- You are a real-time translation bridge between a STAFF member and a GUEST.
- STAFF: Always speaks ${staffLanguage}.
- GUEST: Speaks a language that you must detect automatically.

SPEAKER IDENTIFICATION RULES:
1. If the input is in ${staffLanguage}, treat it as STAFF.
2. If the input is in any other language, treat it as GUEST.
3. On EVERY GUEST utterance, call the "report_guest_language" tool before translating, even if the language did not change.

TRANSLATION DIRECTION:
- GUEST -> translate into ${staffLanguage}.
- STAFF -> translate into the GUEST's latest detected language.
- Never translate a STAFF message into English unless English is actually the guest's latest detected language.

CRITICAL BEHAVIOR:
- The guest language is dynamic and may change when a new guest speaks.
- The most recently detected guest language becomes the target language for future STAFF replies.
- Preserve meaning, tone, politeness level, and intent exactly.
`;
  } else if (!isAutoGuest && isAutoStaff) {
    // Reverse Mode: Guest language fixed, Staff language auto-detected
    instruction = `
ROLE IDENTIFICATION & CONTEXT:
- GUEST always speaks ${guestLanguage}.
- STAFF language must be detected automatically.

TRANSLATION DIRECTION:
- GUEST (${guestLanguage}) -> translate into the STAFF's detected language.
- STAFF -> translate into ${guestLanguage}.

CRITICAL BEHAVIOR:
- Preserve tone, politeness, and intent exactly.
- Do not add labels or explanations.
`;
  } else if (isAutoGuest && isAutoStaff) {
    // Full Auto Mode
    instruction = `
${dynamicSessionState}
ROLE IDENTIFICATION & CONTEXT:
- One speaker is STAFF.
- One speaker is GUEST.
- Detect the spoken language on every turn.

RULES:
1. Any guest utterance in a non-staff language should be reported using "report_guest_language" before translating.
2. GUEST speech -> translate into the STAFF language.
3. STAFF speech -> translate into the latest detected GUEST language.
4. If there is no prior detected guest language yet, translate using best-effort contextual speaker detection.

CRITICAL BEHAVIOR:
- Prefer continuity: the latest detected guest language remains the reply target for STAFF turns until a new guest language is detected.
- Preserve tone, intent, and level of formality.
`;
  } else {
    // Fixed Mode
    instruction = `
ROLE IDENTIFICATION & CONTEXT:
- GUEST always speaks ${guestLanguage}.
- STAFF always speaks ${staffLanguage}.

TRANSLATION DIRECTION:
- If the speaker uses ${guestLanguage}, translate into ${staffLanguage}.
- If the speaker uses ${staffLanguage}, translate into ${guestLanguage}.

CRITICAL BEHAVIOR:
- Preserve tone, politeness, and intent exactly.
- Do not add labels or explanations.
`;
  }

  const samples = `
FEW-SHOT EXAMPLES:

Example 1:
- Guest (Tagalog): Magandang araw sayo.
- Output: Goedendag.

Example 2:
- Staff (${staffLanguage}): Goedendag, hoe gaat het met jou?
- Output: Magandang araw, kumusta ka?

Example 3:
- Guest (Japanese): こんばんは、部屋のキーをなくしてしまいました。
- Output: Goedenavond, ik ben mijn kamersleutel kwijt.

Example 4:
- Staff (${staffLanguage}): Geen zorgen, ik maak direct een nieuwe voor u.
- Output: ご安心ください、すぐに新しいものをお作りします。

Example 5:
- Guest (Arabic): مرحباً، أريد حجز غرفة.
- Output: Hallo, ik wil een kamer boeken.

Example 6:
- Staff (${staffLanguage}): Zeker, voor hoeveel nachten?
- Output: بالتأكيد، لِكَم ليلة؟

Example 7:
- Guest (Spanish): ¿Dónde está el ascensor?
- Output: Waar is de lift?

Example 8:
- Staff (${staffLanguage}): Het is om de hoek.
- Output: Está a la vuelta de la esquina.

Example 9:
- Guest (Chinese): 你好，我想问一下健身房在几楼？
- Output: Hallo, ik wil vragen op welke verdieping de fitnessruimte is.

Example 10:
- Staff (${staffLanguage}): De fitnessruimte bevindt zich op de derde verdieping.
- Output: 健身房在三楼。
`;

  const topicInstruction = topic
    ? `The conversation is about ${topic}. Use precise terminology and preserve the intended context.`
    : '';

  return `You are an expert, seamless voice interpreter.
${instruction}

${samples}

CRITICAL INSTRUCTIONS:
- Output ONLY the translated text.
- Do not include labels, explanations, speaker tags, or extra commentary.
- Mimic the speaker's tone, emotion, speed, rhythm, and emphasis.
- If the speaker is whispering, whisper.
- If the speaker is excited, sound excited.
- Be accurate in nuance and cultural context.
- Do not hallucinate or make up conversation.
- Only translate what is heard.

${topicInstruction}
`;
};

/**
 * Settings
 */
type SettingsStore = {
  systemPrompt: string;
  model: string;
  voice1: string;
  voice2: string;
  guestLanguage: string;
  staffLanguage: string;
  topic: string;
  lastGuestLanguage: string;
  apiKey: string;
  setSystemPrompt: (prompt: string) => void;
  setModel: (model: string) => void;
  setVoice1: (voice: string) => void;
  setVoice2: (voice: string) => void;
  setGuestLanguage: (language: string) => void;
  setStaffLanguage: (language: string) => void;
  setTopic: (topic: string) => void;
  setLastGuestLanguage: (language: string) => void;
  setApiKey: (key: string) => void;
};

export const useSettings = create<SettingsStore>((set, get) => ({
  systemPrompt: generateSystemPrompt('auto', 'Dutch (Flemish)', '', 'none'),
  model: DEFAULT_LIVE_API_MODEL,
  voice1: DEFAULT_VOICE_STAFF,
  voice2: DEFAULT_VOICE_GUEST,
  guestLanguage: 'auto',
  staffLanguage: 'Dutch (Flemish)',
  topic: '',
  lastGuestLanguage: 'none',
  apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',

  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  setModel: (model) => set({ model }),
  setVoice1: (voice) => set({ voice1: voice }),
  setVoice2: (voice) => set({ voice2: voice }),

  setGuestLanguage: (language) =>
    set(() => ({
      guestLanguage: language,
      systemPrompt: generateSystemPrompt(
        language,
        get().staffLanguage,
        get().topic,
        get().lastGuestLanguage,
      ),
    })),

  setStaffLanguage: (language) =>
    set(() => ({
      staffLanguage: language,
      systemPrompt: generateSystemPrompt(
        get().guestLanguage,
        language,
        get().topic,
        get().lastGuestLanguage,
      ),
    })),

  setTopic: (topic) =>
    set(() => ({
      topic,
      systemPrompt: generateSystemPrompt(
        get().guestLanguage,
        get().staffLanguage,
        topic,
        get().lastGuestLanguage,
      ),
    })),

  setLastGuestLanguage: (language) =>
    set(() => ({
      lastGuestLanguage: language,
      systemPrompt: generateSystemPrompt(
        get().guestLanguage,
        get().staffLanguage,
        get().topic,
        language,
      ),
    })),

  setApiKey: (key) => set({ apiKey: key }),
}));

/**
 * UI
 */
type UITab = 'settings' | 'history';

type UIStore = {
  isSidebarOpen: boolean;
  activeTab: UITab;
  toggleSidebar: () => void;
  setActiveTab: (tab: UITab) => void;
};

export const useUI = create<UIStore>((set) => ({
  isSidebarOpen: false,
  activeTab: 'settings',
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));

/**
 * Tools
 */
export interface FunctionCall {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  isEnabled: boolean;
  scheduling: FunctionResponseScheduling;
}

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}

export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

export interface ConversationTurn {
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  isFinal: boolean;
  detectedSpeaker?: 'Staff' | 'Guest' | 'System';
  detectedLanguage?: string;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
}

type LogStore = {
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
  setTurns: (turns: ConversationTurn[]) => void;
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => void;
  updateTurnAt: (
    index: number,
    update: Partial<Omit<ConversationTurn, 'timestamp'>>,
  ) => void;
  clearTurns: () => void;
};

export const useLogStore = create<LogStore>((set) => ({
  turns: [],

  addTurn: (turn) =>
    set((state) => ({
      turns: [...state.turns, { ...turn, timestamp: new Date() }],
    })),

  setTurns: (turns) => set({ turns }),

  updateLastTurn: (update) =>
    set((state) => {
      if (state.turns.length === 0) return state;

      const newTurns = [...state.turns];
      newTurns[newTurns.length - 1] = {
        ...newTurns[newTurns.length - 1],
        ...update,
      };

      return { turns: newTurns };
    }),

  updateTurnAt: (index, update) =>
    set((state) => {
      if (index < 0 || index >= state.turns.length) return state;

      const newTurns = [...state.turns];
      newTurns[index] = {
        ...newTurns[index],
        ...update,
      };

      return { turns: newTurns };
    }),

  clearTurns: () => set({ turns: [] }),
}));
