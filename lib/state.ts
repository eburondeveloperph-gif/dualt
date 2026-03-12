/**

@license

SPDX-License-Identifier: Apache-2.0
*/
// cspell:ignore genai
import { create } from 'zustand';
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE_STAFF, DEFAULT_VOICE_GUEST } from './constants';
import {
FunctionDeclaration,
FunctionResponse,
FunctionResponseScheduling,
LiveServerToolCall,
Schema,
Type,
} from '@google/genai';

export const declaration: FunctionDeclaration = {
  name: 'report_guest_language',
  description: 'Report the detected language of the Guest. Use this when the Guest speaks a new language to ensure future translations (especially Staff to Guest) use this language. Provide the language name in English (e.g., "Tagalog", "Japanese", "Arabic").',
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

const generateSystemPrompt = (guestLanguage: string, staffLanguage: string, topic: string, lastGuestLanguage?: string) => {
  const isAutoGuest = guestLanguage === 'auto';
  const isAutoStaff = staffLanguage === 'auto';

  let instruction = '';

  const dynamicSessionState = lastGuestLanguage && lastGuestLanguage !== 'none'
    ? `
DYNAMIC SESSION STATE:
- Last Detected Guest Language: ${lastGuestLanguage}
- Staff Target Language: ${lastGuestLanguage}
`
    : '';

  if (isAutoGuest && !isAutoStaff) {
    // Standard Mode: Staff is fixed (usually Dutch), Guest is Auto
    instruction = `
${dynamicSessionState}
ROLE IDENTIFICATION & CONTEXT:
- You are a translation bridge between a HOTEL STAFF and a GUEST.
- STAFF: Always speaks Dutch (${staffLanguage}).
- GUEST: Speaks a foreign language that you must detect.

SPEAKER IDENTIFICATION RULES:
1. If the input is in DUTCH, it is the STAFF speaking.
2. If the input is in ANY OTHER LANGUAGE (e.g., Tagalog, Arabic, Spanish), it is the GUEST speaking.

TRANSLATION DIRECTION:
- STAFF (Dutch) -> MUST be translated into the GUEST's latest detected language.
- GUEST (Other) -> MUST be translated into DUTCH (Staff).

CRITICAL CONSTRAINTS:
- Use the "report_guest_language" tool whenever the Guest speaks a new language.
- DO NOT use English as a fallback for Staff responses if a specific Guest language (like Tagalog) was detected.
- If the Staff speaks Dutch, and the last detected Guest language was Tagalog, the translation MUST be in Tagalog.

Example flows:
- Guest (Tagalog) -> detected Guest -> translate to Dutch (Staff).
- Staff (Dutch) -> detected Staff -> translate back to Tagalog.
- Guest (Arabic) -> detected Guest -> translate to Dutch (Staff).
- Staff (Dutch) -> detected Staff -> translate back to Arabic.
`;
  } else if (!isAutoGuest && isAutoStaff) {
    // Reverse Mode: Guest is fixed, Staff is Auto
    instruction = `
The conversation is between a Guest who always speaks ${guestLanguage} and a Staff member whose language must be detected.

RULES:
1. Translate Guest speech (${guestLanguage}) immediately into the Staff member's latest detected language (assumed Dutch).
2. Translate Staff speech immediately into ${guestLanguage}.
`;
  } else if (isAutoGuest && isAutoStaff) {
    // Full Auto Mode
    instruction = `
Detect the spoken language for each turn. Assume one speaker is Staff (Dutch) and the other is a Guest.

RULES:
1. ALWAYS translate Guest speech into Dutch (Staff).
2. ALWAYS translate Dutch (Staff) speech into the Guest's LATEST detected language.
3. Use SPEAKER IDENTIFICATION: Dutch = Staff, Anything else = Guest.
`;
  } else {
    // Fixed Mode
    instruction = `
The conversation uses two fixed languages: Guest (${guestLanguage}) and Staff (${staffLanguage}).

RULES:
1. If the speaker uses ${staffLanguage}, translate immediately into ${guestLanguage}.
2. If the speaker uses ${guestLanguage}, translate immediately into ${staffLanguage}.
`;
  }

  const samples = `
FEW-SHOT EXAMPLES:
- Guest (Tagalog): Magandang araw sayo, kapatid. -> Translation: Goedendag, broeder. (Detected Tagalog, translating to Dutch)
- Staff (Dutch): Goedendag, hoe gaat het met jou? -> Translation: Magandang araw, kumusta ka? (Targeting Tagalog because it was last spoken)
- Guest (Japanese): こんばんは、部屋のキーをなくしてしまいました。 -> Translation: Goenvond, ik ben mijn kamersleutel kwijt. (Detected Japanese, translating to Dutch)
- Staff (Dutch): Geen zorgen, ik maak direct een nieuwe voor u. -> Translation: ご安心ください、すぐに新しいものをお作りします。 (Targeting Japanese because it was last spoken)
- Guest (Arabic): مرحباً، أريد حجز غرفة. -> Translation: Hallo, ik wil een kamer boeken. (Detected Arabic, translating to Dutch)
- Staff (Dutch): Zeker, voor hoeveel nachten? -> Translation: بالتأكيد، لكم ليلة؟ (Targeting Arabic because it was last spoken)
- Guest (Spanish): ¿Dónde está el ascensor? -> Translation: Waar is de lift? (Detected Spanish, translating to Dutch)
- Staff (Dutch): Het is om de hoek. -> Translation: Está a la vuelta de la esquina. (Targeting Spanish because it was last spoken)
- Guest (Chinese): 你好，我想问一下健身房在几楼？ -> Translation: Hallo, ik wil vragen op welke verdieping de sportschool is? (Detected Chinese, translating to Dutch)
- Staff (Dutch): De sportschool bevindt zich op de derde verdieping. -> Translation: 健身房在三楼。 (Targeting Chinese because it was last spoken)
`;

  const topicInstruction = topic
    ? `The conversation is about ${topic}. Use precise terminology and preserve the intended context.`
    : '';

  return `You are an expert, seamless voice interpreter.
${instruction}

${samples}

CRITICAL INSTRUCTIONS:

Output ONLY the translated text. Do not include labels, explanations, or extra commentary.

Mimic the speaker's tone, emotion, speed, rhythm, and emphasis.

If the speaker is whispering, whisper. If they are excited, sound excited.

Be accurate in nuance and cultural context.

Do not hallucinate or make up conversation. Only translate what is heard.

${topicInstruction}
`;
};

/**

Settings
*/
export const useSettings = create<{
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
}>((set, get) => ({
systemPrompt: generateSystemPrompt('auto', 'Dutch (Flemish)', '', 'none'),
model: DEFAULT_LIVE_API_MODEL,
voice1: DEFAULT_VOICE_STAFF,
voice2: DEFAULT_VOICE_GUEST,
guestLanguage: 'auto',
staffLanguage: 'Dutch (Flemish)',
topic: '',
lastGuestLanguage: 'none',
apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
setSystemPrompt: prompt => set({ systemPrompt: prompt }),
setModel: model => set({ model }),
setVoice1: voice => set({ voice1: voice }),
setVoice2: voice => set({ voice2: voice }),
setGuestLanguage: language => set({
guestLanguage: language,
systemPrompt: generateSystemPrompt(language, get().staffLanguage, get().topic, get().lastGuestLanguage)
}),
setStaffLanguage: language => set({
staffLanguage: language,
systemPrompt: generateSystemPrompt(get().guestLanguage, language, get().topic, get().lastGuestLanguage)
}),
setTopic: topic => set({
topic: topic,
systemPrompt: generateSystemPrompt(get().guestLanguage, get().staffLanguage, topic, get().lastGuestLanguage)
}),
setLastGuestLanguage: language => set({ lastGuestLanguage: language }),
setApiKey: key => set({ apiKey: key }),
}));

/**

UI
*/
export const useUI = create<{
isSidebarOpen: boolean;
activeTab: 'settings' | 'history';
toggleSidebar: () => void;
setActiveTab: (tab: 'settings' | 'history') => void;
}>(set => ({
isSidebarOpen: false,
activeTab: 'settings',
toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
setActiveTab: (tab: 'settings' | 'history') => set({ activeTab: tab }),
}));

/**

Tools
*/
export interface FunctionCall {
name: string;
description: string;
parameters: any;
isEnabled: boolean;
scheduling: FunctionResponseScheduling;
}

/**

Logs
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

export const useLogStore = create<{
turns: ConversationTurn[];
addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
setTurns: (turns: ConversationTurn[]) => void;
updateLastTurn: (update: Partial<ConversationTurn>) => void;
clearTurns: () => void;
}>((set, get) => ({
turns: [],
addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) =>
set(state => ({
turns: [...state.turns, { ...turn, timestamp: new Date() }],
})),
setTurns: (turns: ConversationTurn[]) => set({ turns }),
updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
set(state => {
if (state.turns.length === 0) {
return state;
}
const newTurns = [...state.turns];
const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
newTurns[newTurns.length - 1] = lastTurn;
return { turns: newTurns };
});
},
clearTurns: () => set({ turns: [] }),
}));
