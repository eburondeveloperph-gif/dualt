
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
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

  // We align: lang1 = Staff, lang2 = Guest
  let instruction = '';

  if (!isAuto1 && isAuto2) {
    // Staff (lang1) is Fixed (e.g. Dutch), Guest (lang2) is Auto
    instruction = `
    The conversation is between a Staff member (always speaking ${lang1}) and a Guest (language to be detected).
    
    RULES:
    1. **Double Interaction Mode**: You are translating for TWO distinct speakers.
    2. **Staff (${lang1})**: When you hear ${lang1}, assume it is the Staff. Translate it IMMMEDIATELY to the Guest's language (the language they last spoke).
       - *Crucial*: If the Guest hasn't spoken yet, or their language is not yet detected, default to English for the Staff's translation.
    3. **Guest (Auto Detect)**: When you hear any language that is NOT ${lang1}, assume it is the Guest. Translate it IMMEDIATELY to ${lang1}.
    4. **Memory**: Lock on to the language detected from the Guest. Use this specific language as the target for all subsequent translations of the Staff's ${lang1} speech.
    
    Example Flow (Staff speaks Dutch):
    - Guest speaks Filipino -> You translate to Dutch.
    - Staff speaks Dutch -> You translate to Filipino.
    - Guest speaks Spanish -> You translate to Dutch.
    - Staff speaks Dutch -> You translate to Spanish.
    `;
  } else if (isAuto1 && !isAuto2) {
    // Guest (lang2) is Fixed, Staff (lang1) is Auto
    instruction = `
    The conversation is between a Guest (always speaking ${lang2}) and a Staff member (language to be detected).
    
    RULES:
    1. If you hear ${lang2} (Guest), translate it to the language the Staff most recently spoke (or English if unknown).
    2. If you hear any other language (Staff), translate it to ${lang2}.
    `;
  } else if (isAuto1 && isAuto2) {
    // Both Auto
    instruction = `Detect the language of the audio and translate it to English if it is not English. If it is English, translate it to the other detected language from context.`;
  } else {
    // Both fixed
    instruction = `Translate text from ${lang1} to ${lang2} and vice-versa.`;
  }

  const topicInstruction = topic ? `The conversation is about: ${topic}. Please use appropriate terminology and context.` : '';

  return `You are an expert, seamless voice interpreter. 
${instruction}

**CRITICAL INSTRUCTIONS:**
1. **Output ONLY the translated text.** Do not include "Translation:", "In Dutch:", or any explanations.
2. **MIMIC the speaker's voice elements**:
   - Tone, emotion, speed, rhythm, emphasis.
   - If the speaker is whispering, whisper. If they are excited, be excited.
3. **Be accurate** in nuance and cultural context.
4. **Do not hallucinate** or make up conversation. Only translate what is heard.

${topicInstruction}
`;
};


/**
 * Settings
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
 * UI
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
 * Tools
 */
export interface FunctionCall {
  name: string;
  description: string;
  parameters: any;
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
    uri: string;
    title: string;
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
