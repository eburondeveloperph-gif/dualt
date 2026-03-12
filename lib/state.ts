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
} from '@google/genai';

const generateSystemPrompt = (lang1: string, lang2: string, topic: string) => {
  const isAuto1 = lang1 === 'auto';
  const isAuto2 = lang2 === 'auto';

  let instruction = '';

  if (!isAuto1 && isAuto2) {
    instruction = `
The conversation is between a Staff member who always speaks Dutch (${lang1}) and a Guest whose language must be detected.

RULES:
1. Translate Guest speech from ANY detected language (Tagalog, Arabic, Spanish, etc.) immediately into Dutch (${lang1}).
2. Translate Staff speech (Dutch) immediately into the Guest's LATEST detected language.
3. CRITICAL: If the Staff speaks Dutch, you MUST translate it back to the language the Guest just used. Do NOT default to English unless the Guest actually spoke English.
4. If no Guest language has been detected yet, keep Dutch (Staff) output in Dutch.
5. Every new Guest utterance defines the target language for the next Staff response.

Example flows:
- Guest (Tagalog) -> translate into Dutch (Staff).
- Staff (Dutch) -> translate into Tagalog.
- Guest (Arabic) -> translate into Dutch (Staff).
- Staff (Dutch) -> translate into Arabic.
- Guest (Spanish) -> translate into Dutch (Staff).
- Staff (Dutch) -> translate into Spanish.
`;
  } else if (isAuto1 && !isAuto2) {
    instruction = `
The conversation is between a Guest who always speaks ${lang2} and a Staff member whose language must be detected.

RULES:
1. Translate Guest speech (${lang2}) immediately into the Staff member's latest detected language (assumed Dutch).
2. Translate Staff speech immediately into ${lang2}.
3. If the Staff speaks Dutch, translate it back to ${lang2}.
4. If the Staff speaks any other language, translate it back to ${lang2}.
`;
  } else if (isAuto1 && isAuto2) {
    instruction = `
Detect the spoken language for each turn. Assume one speaker is Staff (Dutch) and the other is a Guest.

RULES:
1. ALWAYS translate Guest speech into Dutch (Staff).
2. ALWAYS translate Dutch (Staff) speech into the Guest's LATEST detected language.
3. NEVER switch to English permanently; only use it if it was the last spoken language.

Example flow:
- Guest (Tagalog) -> detected Tagalog -> translate to Dutch (Staff).
- Staff (Dutch) -> translate back to Tagalog.
- Guest (Arabic) -> detected Arabic -> translate to Dutch (Staff).
- Staff (Dutch) -> translate back to Arabic.
`;
  } else {
    instruction = `
The conversation uses two fixed languages: ${lang1} and ${lang2}.

RULES:
1. If the speaker uses ${lang1}, translate immediately into ${lang2}.
2. If the speaker uses ${lang2}, translate immediately into ${lang1}.
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
language1: string;
language2: string;
topic: string;
setSystemPrompt: (prompt: string) => void;
setModel: (model: string) => void;
setVoice1: (voice: string) => void;
setVoice2: (voice: string) => void;
setLanguage1: (language: string) => void;
setLanguage2: (language: string) => void;
setTopic: (topic: string) => void;
}>((set, get) => ({
systemPrompt: generateSystemPrompt('Dutch (Flemish)', 'auto', ''),
model: DEFAULT_LIVE_API_MODEL,
voice1: DEFAULT_VOICE_STAFF,
voice2: DEFAULT_VOICE_GUEST,
language1: 'Dutch (Flemish)',
language2: 'auto',
topic: '',
setSystemPrompt: prompt => set({ systemPrompt: prompt }),
setModel: model => set({ model }),
setVoice1: voice => set({ voice1: voice }),
setVoice2: voice => set({ voice2: voice }),
setLanguage1: language => set({
language1: language,
systemPrompt: generateSystemPrompt(language, get().language2, get().topic)
}),
setLanguage2: language => set({
language2: language,
systemPrompt: generateSystemPrompt(get().language1, language, get().topic)
}),
setTopic: topic => set({
topic: topic,
systemPrompt: generateSystemPrompt(get().language1, get().language2, topic)
}),
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
