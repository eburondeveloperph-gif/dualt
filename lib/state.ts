/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// cspell:ignore genai

import { create } from 'zustand';
import {
  AVAILABLE_LANGUAGES,
  DEFAULT_LIVE_API_MODEL,
  DEFAULT_VOICE_GUEST,
  DEFAULT_VOICE_STAFF,
} from './constants';
import {
  Behavior,
  FunctionDeclaration,
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
  Type,
} from '@google/genai';

export const AUTO_DETECT_LANGUAGE = 'auto';
export const AUTO_DETECT_LABEL = 'Auto Detect';
export const DEFAULT_STAFF_LANGUAGE = 'Dutch (Flemish)';
const NO_GUEST_LANGUAGE = 'none';

const LANGUAGE_ALIASES: Record<string, string> = {
  chinese: 'Chinese (Simplified)',
  english: 'English (US)',
  filipino: 'Tagalog (Filipino)',
  flemish: DEFAULT_STAFF_LANGUAGE,
  tagalog: 'Tagalog (Filipino)',
};

const findLanguageValue = (language: string) => {
  const normalizedLanguage = language.trim().toLowerCase();
  const matchingLanguage = AVAILABLE_LANGUAGES.find(
    ({ name, value }) =>
      name.toLowerCase() === normalizedLanguage || value.toLowerCase() === normalizedLanguage,
  );

  if (matchingLanguage) {
    return matchingLanguage.value;
  }

  return LANGUAGE_ALIASES[normalizedLanguage] || language.trim();
};

export const normalizeLanguageValue = (language: string) => {
  const trimmedLanguage = language.trim();

  if (!trimmedLanguage) {
    return '';
  }

  if (trimmedLanguage === AUTO_DETECT_LANGUAGE || trimmedLanguage === NO_GUEST_LANGUAGE) {
    return trimmedLanguage;
  }

  return findLanguageValue(trimmedLanguage);
};

export const getActiveGuestLanguage = (guestLanguage: string, lastGuestLanguage: string) => {
  if (lastGuestLanguage !== NO_GUEST_LANGUAGE) {
    return normalizeLanguageValue(lastGuestLanguage);
  }

  return normalizeLanguageValue(guestLanguage) || AUTO_DETECT_LANGUAGE;
};

export const declaration: FunctionDeclaration = {
  name: 'report_guest_language',
  description:
    'Report the detected language of the Guest on every Guest utterance before translating. This keeps Staff-to-Guest replies targeted to the correct guest language. Provide the language name in English (e.g., "Tagalog", "Japanese", "Arabic").',
  behavior: Behavior.BLOCKING,
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
  const isAutoGuest = guestLanguage === AUTO_DETECT_LANGUAGE;
  const isAutoStaff = staffLanguage === AUTO_DETECT_LANGUAGE;

  const normalizedLastGuestLanguage =
    lastGuestLanguage && lastGuestLanguage !== NO_GUEST_LANGUAGE
      ? normalizeLanguageValue(lastGuestLanguage)
      : '';

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
3. If a GUEST utterance is neither ${staffLanguage} nor the latest detected guest language, treat it as a new guest language immediately.

TRANSLATION DIRECTION:
- GUEST -> translate into ${staffLanguage}.
- STAFF -> translate into the GUEST's latest detected language.
- Never translate a STAFF message into English unless English is actually the guest's latest detected language.

CRITICAL BEHAVIOR:
- The guest language is dynamic and may change when a new guest speaks.
- The most recently detected guest language becomes the target language for future STAFF replies.
- Always translate STAFF replies into the latest detected guest language until a new non-${staffLanguage} guest language is reported.
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
1. Any guest utterance in a non-staff language becomes the active guest language for future STAFF replies.
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
BELGIUM SESSION EXAMPLES:

Session 1 - French:
Guest Speaking (French): "Bonjour, madame. Depuis hier, j’ai mal à la gorge."
Translator Agent -> ${staffLanguage}: "Goeiedag mevrouw. Sinds gisteren heb ik keelpijn."
Staff Speaking (${staffLanguage}): "Heeft u ook koorts, of vooral keelpijn en hoest?"
Translator Agent -> French: "Avez-vous aussi de la fièvre, ou surtout mal à la gorge et de la toux?"
Staff Speaking (${staffLanguage}): "De siroop mag u drie keer per dag nemen."
Translator Agent -> French: "Vous pouvez prendre le sirop trois fois par jour."

Session 2 - German:
Guest Speaking (German): "Guten Tag. Ich habe seit einigen Tagen Allergiesymptome."
Translator Agent -> ${staffLanguage}: "Goeiedag. Ik heb sinds enkele dagen allergiesymptomen."
Staff Speaking (${staffLanguage}): "Dat klinkt als een seizoensallergie."
Translator Agent -> German: "Das klingt nach einer saisonalen Allergie."
Staff Speaking (${staffLanguage}): "We hebben ook oogdruppels tegen jeukende ogen."
Translator Agent -> German: "Wir haben auch Augentropfen gegen juckende Augen."

Session 3 - English:
Guest Speaking (English): "Hello. I’m looking for something for stomach acid."
Translator Agent -> ${staffLanguage}: "Hallo. Ik zoek iets tegen maagzuur."
Staff Speaking (${staffLanguage}): "Hoe lang hebt u daar al last van?"
Translator Agent -> English: "How long have you been dealing with that?"
Staff Speaking (${staffLanguage}): "Beperk tijdelijk pikant eten, koffie en alcohol."
Translator Agent -> English: "Temporarily limit spicy food, coffee, and alcohol."

Session 4 - Arabic:
Guest Speaking (Arabic): "مرحبًا. ابني عنده حرارة خفيفة منذ هذا الصباح."
Translator Agent -> ${staffLanguage}: "Hallo. Mijn zoon heeft sinds deze ochtend lichte koorts."
Staff Speaking (${staffLanguage}): "Hoe oud is uw zoon, en kent u ongeveer zijn gewicht?"
Translator Agent -> Arabic: "كم عمر ابنك، وهل تعرفين وزنه تقريبًا؟"
Staff Speaking (${staffLanguage}): "Voor jonge kinderen raad ik fysiologisch serum aan."
Translator Agent -> Arabic: "بالنسبة للأطفال الصغار، أوصي عادةً بمحلول ملحي."

Session 5 - Turkish:
Guest Speaking (Turkish): "Merhaba. Son birkaç gündür sırt ağrım var."
Translator Agent -> ${staffLanguage}: "Hallo. Sinds enkele dagen heb ik rugpijn."
Staff Speaking (${staffLanguage}): "Is de pijn plots begonnen, of is het geleidelijk erger geworden?"
Translator Agent -> Turkish: "Ağrı aniden mi başladı, yoksa yavaş yavaş mı kötüleşti?"
Staff Speaking (${staffLanguage}): "Rustig blijven bewegen is meestal beter dan stilzitten."
Translator Agent -> Turkish: "Yavaşça hareket etmeye devam etmek genelde tamamen hareketsiz kalmaktan daha iyidir."
`;

  const languageSwitchSamples = `
SESSION BOUNDARY AND LANGUAGE SWITCH RULES:

- Within one active session, the latest detected non-${staffLanguage} guest language remains the reply target for all STAFF turns.
- If a new guest speaks a different non-${staffLanguage} language in the same session, switch immediately to that new guest language for the next STAFF reply.
- When a new session starts, forget the previous guest language and detect the new guest language from scratch.

Example:
Session A starts with French guest speech.
Staff replies must be translated into French until a new non-${staffLanguage} guest language is detected.
Later in Session A, a Turkish guest speaks.
From that moment onward, STAFF replies must be translated into Turkish.
Session B starts after Session A ends.
If the first guest in Session B speaks German, detect German from scratch and translate STAFF replies into German, not French or Turkish.
`;

  const wrongSamples = `
WRONG TRANSLATION EXAMPLES (DO NOT FOLLOW THESE):

Wrong Example 1: Staff reply incorrectly switches to English instead of the last detected guest language
Turn 1 (French): "Bonjour madame."
Turn 2 (${staffLanguage}): "Goedemorgen!"
Turn 3 (${staffLanguage}): "Hoe kan ik u helpen?"
Turn 4 (English): "How can I help you?"
Why wrong: After French was detected, the Staff reply should be translated back into French, not English.

Wrong Example 2: Guest speech is incorrectly translated into English instead of ${staffLanguage}
Turn 1 (German): "Ich habe Allergiesymptome."
Turn 2 (English): "I have allergy symptoms."
Why wrong: Guest speech must be translated into ${staffLanguage}, so the correct output is "Ik heb allergiesymptomen."

Wrong Example 3: The system forgets the latest detected guest language across consecutive Staff replies
Turn 1 (Arabic): "ابني عنده حرارة."
Turn 2 (${staffLanguage}): "Graag een glas water."
Turn 3 (${staffLanguage}): "Natuurlijk, ik breng het zo."
Turn 4 (English): "Of course, I will bring it right away."
Why wrong: Once Arabic was detected, consecutive Staff replies must continue in Arabic until a new guest language is detected.

Wrong Example 4: A new session incorrectly reuses the previous session's guest language
Session 1 final detected guest language: French.
Session 2 first guest utterance: "Guten Tag."
Wrong staff translation target: French.
Why wrong: Each new session must detect the guest language again from scratch, so Session 2 should switch to German.
`;

  const topicInstruction = topic
    ? `The conversation is about ${topic}. Use precise terminology and preserve the intended context.`
    : '';

  return `You are an expert, seamless voice interpreter.
${instruction}

CONVERSATIONAL PATIENCE & TURN-TAKING:
- Wait for the current speaker to finish their entire thought before translating. 
- Allow for natural pauses (short breaths or thinking time) without cutting the speaker off.
- If a speaker pauses but clearly has more to say, wait for completion.
- Provide the translation ONLY when the speaker has finished their utterance.

${samples}

${languageSwitchSamples}

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
  setDetectedGuestLanguage: (language: string) => void;
  resetSessionLanguageState: () => void;
  setApiKey: (key: string) => void;
};

export const useSettings = create<SettingsStore>((set, get) => ({
  systemPrompt: generateSystemPrompt(
    AUTO_DETECT_LANGUAGE,
    DEFAULT_STAFF_LANGUAGE,
    '',
    NO_GUEST_LANGUAGE,
  ),
  model: DEFAULT_LIVE_API_MODEL,
  voice1: DEFAULT_VOICE_STAFF,
  voice2: DEFAULT_VOICE_GUEST,
  guestLanguage: AUTO_DETECT_LANGUAGE,
  staffLanguage: DEFAULT_STAFF_LANGUAGE,
  topic: '',
  lastGuestLanguage: NO_GUEST_LANGUAGE,
  apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',

  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  setModel: (model) => set({ model }),
  setVoice1: (voice) => set({ voice1: voice }),
  setVoice2: (voice) => set({ voice2: voice }),

  setGuestLanguage: (language) =>
    set(() => {
      const normalizedLanguage = normalizeLanguageValue(language);
      const nextGuestLanguage =
        normalizedLanguage === NO_GUEST_LANGUAGE ? AUTO_DETECT_LANGUAGE : normalizedLanguage;

      return {
        guestLanguage: nextGuestLanguage,
        systemPrompt: generateSystemPrompt(
          nextGuestLanguage,
          get().staffLanguage,
          get().topic,
          get().lastGuestLanguage,
        ),
      };
    }),

  setStaffLanguage: (language) =>
    set(() => {
      const normalizedLanguage = normalizeLanguageValue(language) || DEFAULT_STAFF_LANGUAGE;

      return {
        staffLanguage: normalizedLanguage,
        systemPrompt: generateSystemPrompt(
          get().guestLanguage,
          normalizedLanguage,
          get().topic,
          get().lastGuestLanguage,
        ),
      };
    }),

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
    set(() => {
      const normalizedLanguage = normalizeLanguageValue(language);
      const nextGuestLanguage =
        normalizedLanguage && normalizedLanguage !== AUTO_DETECT_LANGUAGE
          ? normalizedLanguage
          : NO_GUEST_LANGUAGE;

      return {
        lastGuestLanguage: nextGuestLanguage,
        systemPrompt: generateSystemPrompt(
          get().guestLanguage,
          get().staffLanguage,
          get().topic,
          nextGuestLanguage,
        ),
      };
    }),

  setDetectedGuestLanguage: (language) =>
    set(() => {
      const normalizedLanguage = normalizeLanguageValue(language);

      if (
        !normalizedLanguage ||
        normalizedLanguage === AUTO_DETECT_LANGUAGE ||
        normalizedLanguage === NO_GUEST_LANGUAGE ||
        normalizedLanguage === get().staffLanguage
      ) {
        return {};
      }

      return {
        lastGuestLanguage: normalizedLanguage,
        systemPrompt: generateSystemPrompt(
          get().guestLanguage,
          get().staffLanguage,
          get().topic,
          normalizedLanguage,
        ),
      };
    }),

  resetSessionLanguageState: () =>
    set(() => ({
      guestLanguage: AUTO_DETECT_LANGUAGE,
      staffLanguage: DEFAULT_STAFF_LANGUAGE,
      lastGuestLanguage: NO_GUEST_LANGUAGE,
      systemPrompt: generateSystemPrompt(
        AUTO_DETECT_LANGUAGE,
        DEFAULT_STAFF_LANGUAGE,
        get().topic,
        NO_GUEST_LANGUAGE,
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
