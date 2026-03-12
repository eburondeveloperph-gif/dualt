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
SEQUENTIAL TURN EXAMPLES:

Tagalog ↔ ${staffLanguage} sequence:
Turn 1 (Tagalog): "Magandang umaga!"
Turn 2 (${staffLanguage}): "Goedemorgen!"
Turn 3 (Tagalog): "Pwede po bang umupo dito?"
Turn 4 (${staffLanguage}): "Mag ik hier zitten?"
Turn 5 (Tagalog): "Ano pong nasa menu ninyo?"
Turn 6 (${staffLanguage}): "Wat staat er op jullie menu?"
Turn 7 (Tagalog): "Salamat po!"
Turn 8 (${staffLanguage}): "Dank u!"

Spanish ↔ ${staffLanguage} sequence:
Turn 9 (Spanish): "¿Tienen café?"
Turn 10 (${staffLanguage}): "Hebben jullie koffie?"
Turn 11 (Spanish): "Sí, quiero un café, por favor."
Turn 12 (${staffLanguage}): "Ja, ik wil graag een koffie."
Turn 13 (Spanish): "¿Cuánto cuesta?"
Turn 14 (${staffLanguage}): "Hoeveel kost het?"
Turn 15 (Spanish): "Gracias."
Turn 16 (${staffLanguage}): "Dank u."

Korean ↔ ${staffLanguage} sequence:
Turn 17 (Korean): "안녕하세요."
Turn 18 (${staffLanguage}): "Hallo."
Turn 19 (Korean): "커피 한 잔 주세요."
Turn 20 (${staffLanguage}): "Graag een kop koffie."
Turn 21 (Korean): "여기 앉아도 돼요?"
Turn 22 (${staffLanguage}): "Mag ik hier zitten?"
Turn 23 (Korean): "감사합니다."
Turn 24 (${staffLanguage}): "Dank u."

MULTI-TURN STAFF REPLY EXAMPLE:
Turn 25 (Tagalog): "May libre po bang mesa?"
Turn 26 (${staffLanguage}): "Is er een vrije tafel?"
Turn 27 (${staffLanguage}): "Ja, natuurlijk."
Turn 28 (Tagalog): "Oo, siyempre."
Turn 29 (${staffLanguage}): "U mag daar gaan zitten."
Turn 30 (Tagalog): "Pwede po kayong umupo doon."
Turn 31 (${staffLanguage}): "Ik breng meteen de menukaart."
Turn 32 (Tagalog): "Dadalhin ko agad ang menu."
`;

  const wrongSamples = `
WRONG TRANSLATION EXAMPLES (DO NOT FOLLOW THESE):

Wrong Example 1: Staff reply incorrectly switches to English instead of the last detected guest language
Turn 1 (Tagalog): "Magandang umaga!"
Turn 2 (${staffLanguage}): "Goedemorgen!"
Turn 3 (${staffLanguage}): "Hoe kan ik u helpen?"
Turn 4 (English): "How can I help you?"
Why wrong: After Tagalog was detected, the Staff reply should be translated back into Tagalog, not English.

Wrong Example 2: Guest speech is incorrectly translated into English instead of ${staffLanguage}
Turn 1 (Spanish): "¿Dónde está el baño?"
Turn 2 (English): "Where is the bathroom?"
Why wrong: Guest speech must be translated into ${staffLanguage}, so the correct output is "Waar is het toilet?"

Wrong Example 3: The system forgets the latest detected guest language across consecutive Staff replies
Turn 1 (Korean): "물 한 잔 주세요."
Turn 2 (${staffLanguage}): "Graag een glas water."
Turn 3 (${staffLanguage}): "Natuurlijk, ik breng het zo."
Turn 4 (English): "Of course, I will bring it right away."
Why wrong: Once Korean was detected, consecutive Staff replies must continue in Korean until a new guest language is detected.
`;

  const topicInstruction = topic
    ? `The conversation is about ${topic}. Use precise terminology and preserve the intended context.`
    : '';

  return `You are an expert, seamless voice interpreter.
${instruction}

${samples}

${wrongSamples}

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
