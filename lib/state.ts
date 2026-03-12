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
The conversation is between a Staff member who always speaks ${lang1} and a Guest whose language must be detected.

RULES:
1. When you hear ${lang1}, treat that speaker as the Staff member.
2. Translate Staff speech immediately into the Guest's latest detected language.
3. Always translate back from ${lang1} into the latest detected Guest language that was spoken most recently.
4. If no Guest language has been detected yet, keep Staff output in ${lang1}.
5. When you hear any language other than ${lang1}, treat that speaker as the Guest and translate immediately into ${lang1}.
6. Each new Guest utterance replaces the remembered Guest language for the next Staff response.

Example flow:
- Guest speaks Arabic -> translate it to ${lang1}.
- Staff speaks ${lang1} -> translate it to Arabic.
- Guest speaks Filipino -> translate it to ${lang1}.
- Staff speaks ${lang1} -> translate it to Filipino.
- Guest speaks Spanish -> translate it to ${lang1}.
- Staff speaks ${lang1} -> translate it to Spanish.
`;
  } else if (isAuto1 && !isAuto2) {
    instruction = `
The conversation is between a Guest who always speaks ${lang2} and a Staff member whose language must be detected.

RULES:
1. When you hear ${lang2}, treat that speaker as the Guest.
2. Translate Guest speech immediately into the Staff member's latest detected language.
3. Always translate back from ${lang2} into the latest detected Staff language that was spoken most recently.
4. If no Staff language has been detected yet, keep Guest output in ${lang2}.
5. When you hear any language other than ${lang2}, treat that speaker as the Staff member and translate immediately into ${lang2}.
6. Each new Staff utterance replaces the remembered Staff language for the next Guest response.

Example flow:
- Staff speaks Arabic -> translate it to ${lang2}.
- Guest speaks ${lang2} -> translate it to Arabic.
- Staff speaks Dutch -> translate it to ${lang2}.
- Guest speaks ${lang2} -> translate it to Dutch.
- Staff speaks Spanish -> translate it to ${lang2}.
- Guest speaks ${lang2} -> translate it to Spanish.
`;
  } else if (isAuto1 && isAuto2) {
    instruction = `
Detect the spoken language for each turn.

RULES:
1. Translate the current speech into the latest detected language from the other speaker.
2. If only one language has been detected so far, keep the current speech in its original language.

Example flow:
- Speaker A uses Arabic -> detected Arabic.
- Speaker B uses Dutch -> translate B to Arabic.
- Speaker A uses Spanish -> translate A to Dutch (last detected for B).
- Speaker B uses English -> translate B to Spanish (last detected for A).
`;
  } else {
    instruction = `
The conversation uses two fixed languages: ${lang1} and ${lang2}.

RULES:
1. If the speaker uses ${lang1}, translate immediately into ${lang2}.
2. If the speaker uses ${lang2}, translate immediately into ${lang1}.
`;
  }

  const topicInstruction = topic
    ? `The conversation is about ${topic}. Use precise terminology and preserve the intended context.`
    : '';

  return `You are an expert, seamless voice interpreter.
${instruction}

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
