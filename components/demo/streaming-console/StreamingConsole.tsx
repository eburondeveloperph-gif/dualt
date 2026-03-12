
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import WelcomeScreen from '../welcome-screen/WelcomeScreen';
import {
  FunctionCallingConfigMode,
  Modality,
  LiveServerContent,
  LiveServerToolCall,
} from '@google/genai';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  normalizeLanguageValue,
  useSettings,
  useLogStore,
  ConversationTurn,
  declaration,
} from '../../../lib/state';
import { useHistoryStore } from '../../../lib/history';
import { useAuth, updateUserConversations, fetchUserConversations } from '../../../lib/auth';

const AUTO_DETECT_LABEL = 'Auto Detect';
const TAGALOG_MARKERS = [
  'magandang',
  'salamat',
  'kapatid',
  'pwede',
  'po',
  'ano',
  'umaga',
  'kailangan',
  'dito',
  'doon',
  'ninyo',
  'siyempre',
  'kayong',
  'dadalhin',
];
const SPANISH_MARKERS = [
  'gracias',
  'por favor',
  'dónde',
  'cuánto',
  'quiero',
  'tienen',
  'café',
  'baño',
];
const FRENCH_MARKERS = [
  'bonjour',
  'est-ce que',
  'fièvre',
  'gorge',
  'toux',
  'voudrais',
  'somnolence',
  's’il',
];
const GERMAN_MARKERS = [
  'guten tag',
  'allergiesymptome',
  'atemprobleme',
  'nasenspray',
  'augentropfen',
  'verstehe',
  'bitte',
];
const ITALIAN_MARKERS = [
  'buonasera',
  'specialità',
  'cappuccino',
  'allora',
  'voglio',
];
const PORTUGUESE_MARKERS = [
  'olá',
  'água',
  'sumo',
  'casa de banho',
  'um copo',
];
const TURKISH_MARKERS = [
  'merhaba',
  'sırt ağrım',
  'ağrı',
  'bacaklarıma',
  'teşekkür ederim',
  'teşekkür',
];
const ENGLISH_MARKERS = [
  'hello',
  'stomach acid',
  'burning sensation',
  'after meals',
  'spicy food',
  'lie down',
  'please',
  'doctor',
  'i’ll take',
];
const DUTCH_MARKERS = [
  'goedemorgen',
  'goedemiddag',
  'goedenavond',
  'goeiedag',
  'hoe gaat',
  'hoe lang',
  'hoe oud',
  'hoeveel keer',
  'dat klinkt',
  'in dat geval',
  'alstublieft',
  'graag',
  'kunt u',
  'mag ik',
  'dank u',
  'graag gedaan',
  'met plezier',
  'natuurlijk',
  'vlaanderen',
  'koorts',
  'keelpijn',
  'hoest',
  'maagzuur',
  'dokter',
];

type InputTurnClassification = {
  detectedLanguage?: string;
  detectedSpeaker?: ConversationTurn['detectedSpeaker'];
};

const normalizeForDetection = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');

const includesAny = (text: string, markers: string[]) =>
  markers.some(marker => text.includes(normalizeForDetection(marker)));

const looksLikeDutch = (text: string) => {
  if (!text.trim()) {
    return false;
  }

  const normalized = normalizeForDetection(text);
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]/u.test(text)) {
    return false;
  }

  const markerCount = DUTCH_MARKERS.filter(marker => normalized.includes(marker)).length;
  return markerCount >= 1;
};

const detectGuestLanguageFromText = (text: string) => {
  const normalized = normalizeForDetection(text);

  if (!normalized) {
    return null;
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'Korean';
  }
  if (/[\u3040-\u30ff]/.test(text)) {
    return 'Japanese';
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'Chinese (Simplified)';
  }
  if (/[\u0600-\u06ff]/.test(text)) {
    return 'Arabic';
  }
  if (/[\u0370-\u03ff]/.test(text)) {
    return 'Greek';
  }
  if (/[\u0400-\u04ff]/.test(text)) {
    return 'Russian';
  }
  if (/[\u0590-\u05ff]/.test(text)) {
    return 'Hebrew';
  }
  if (includesAny(normalized, TAGALOG_MARKERS)) {
    return 'Tagalog (Filipino)';
  }
  if (/[¿¡]/.test(text) || includesAny(normalized, SPANISH_MARKERS)) {
    return 'Spanish';
  }
  if (includesAny(normalized, FRENCH_MARKERS)) {
    return 'French';
  }
  if (includesAny(normalized, GERMAN_MARKERS)) {
    return 'German';
  }
  if (includesAny(normalized, ITALIAN_MARKERS)) {
    return 'Italian';
  }
  if (includesAny(normalized, PORTUGUESE_MARKERS)) {
    return 'Portuguese (Portugal)';
  }
  if (includesAny(normalized, TURKISH_MARKERS)) {
    return 'Turkish';
  }
  if (!looksLikeDutch(text) && includesAny(normalized, ENGLISH_MARKERS)) {
    return 'English (US)';
  }

  return null;
};

const classifyInputTurn = (text: string, staffLanguage: string): InputTurnClassification => {
  if (looksLikeDutch(text)) {
    return {
      detectedLanguage: staffLanguage,
      detectedSpeaker: 'Staff',
    };
  }

  const detectedGuestLanguage = detectGuestLanguageFromText(text);
  if (detectedGuestLanguage) {
    return {
      detectedLanguage: detectedGuestLanguage,
      detectedSpeaker: 'Guest',
    };
  }

  if (text.trim()) {
    return {
      detectedLanguage: AUTO_DETECT_LABEL,
      detectedSpeaker: 'Guest',
    };
  }

  return {};
};

const findLastUserTurnIndex = (turns: ConversationTurn[]) => {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      return i;
    }
  }
  return null;
};

const resolveSourceTurn = (
  turns: ConversationTurn[],
  activeUserTurnIndex: number | null,
) => {
  if (
    activeUserTurnIndex !== null &&
    activeUserTurnIndex >= 0 &&
    activeUserTurnIndex < turns.length &&
    turns[activeUserTurnIndex]?.role === 'user'
  ) {
    return turns[activeUserTurnIndex];
  }

  const lastUserTurnIndex = findLastUserTurnIndex(turns);
  return lastUserTurnIndex !== null ? turns[lastUserTurnIndex] : undefined;
};

const buildAgentTurnMetadata = (
  sourceTurn: ConversationTurn | undefined,
  guestLanguage: string,
  staffLanguage: string,
  lastGuestLanguage: string,
) => {
  const sourceLooksLikeGuest =
    sourceTurn?.detectedSpeaker === 'Guest' ||
    Boolean(
      sourceTurn?.detectedLanguage &&
      sourceTurn.detectedLanguage !== AUTO_DETECT_LABEL &&
      sourceTurn.detectedLanguage !== staffLanguage,
    );

  const detectedSpeaker: ConversationTurn['detectedSpeaker'] = sourceLooksLikeGuest
    ? 'Guest'
    : 'Staff';

  const detectedLanguage =
    detectedSpeaker === 'Guest'
      ? staffLanguage
      : guestLanguage === 'auto'
        ? lastGuestLanguage !== 'none'
          ? lastGuestLanguage
          : AUTO_DETECT_LABEL
        : guestLanguage;

  return {
    detectedSpeaker,
    detectedLanguage,
  };
};

export default function StreamingConsole() {
  const { client, setConfig } = useLiveAPIContext();
  const { systemPrompt, voice1 } = useSettings();
  const { addHistoryItem } = useHistoryStore();
  const { user } = useAuth();

  const turns = useLogStore(state => state.turns);
  const activeUserTurnIndexRef = useRef<number | null>(null);
  const activeAgentTurnIndexRef = useRef<number | null>(null);
  const agentTurnHasContentRef = useRef(false);

  // Fetch history on mount
  useEffect(() => {
    if (user) {
      fetchUserConversations(user.id).then(history => {
        useLogStore.getState().setTurns(history);
      });
    }
  }, [user]);

  // Set the configuration for the Live API
  useEffect(() => {
    const config: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice1,
          },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },
      tools: [{ functionDeclarations: [declaration] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.VALIDATED,
          allowedFunctionNames: [declaration.name],
        },
      },
    };

    setConfig(config);
  }, [setConfig, systemPrompt, voice1]);

  useEffect(() => {
    const createAgentTurn = (
      text: string,
      isFinal: boolean,
      groundingChunks?: ConversationTurn['groundingChunks'],
      preferContentText: boolean = false,
    ) => {
      const { guestLanguage, staffLanguage, lastGuestLanguage } = useSettings.getState();
      const { turns, addTurn } = useLogStore.getState();
      const sourceTurn = resolveSourceTurn(turns, activeUserTurnIndexRef.current);
      const metadata = buildAgentTurnMetadata(
        sourceTurn,
        guestLanguage,
        staffLanguage,
        lastGuestLanguage,
      );

      addTurn({
        role: 'agent',
        text,
        isFinal,
        groundingChunks,
        ...metadata,
      });

      activeAgentTurnIndexRef.current = useLogStore.getState().turns.length - 1;
      agentTurnHasContentRef.current = preferContentText && Boolean(text);
    };

    const handleInputTranscription = (text: string, isFinal: boolean) => {
      const { staffLanguage } = useSettings.getState();
      const { turns, addTurn, updateTurnAt } = useLogStore.getState();
      const activeUserTurnIndex = activeUserTurnIndexRef.current;
      const activeUserTurn =
        activeUserTurnIndex !== null ? turns[activeUserTurnIndex] : undefined;
      const classification = classifyInputTurn(text, staffLanguage);

      if (activeUserTurn?.role === 'user' && !activeUserTurn.isFinal) {
        if (
          classification.detectedSpeaker === 'Guest' &&
          classification.detectedLanguage &&
          classification.detectedLanguage !== AUTO_DETECT_LABEL
        ) {
          useSettings.getState().setDetectedGuestLanguage(classification.detectedLanguage);
        }

        updateTurnAt(activeUserTurnIndex!, {
          text,
          isFinal,
          ...classification,
        });
        return;
      }

      if (
        classification.detectedSpeaker === 'Guest' &&
        classification.detectedLanguage &&
        classification.detectedLanguage !== AUTO_DETECT_LABEL
      ) {
        useSettings.getState().setDetectedGuestLanguage(classification.detectedLanguage);
      }

      addTurn({
        role: 'user',
        text,
        isFinal,
        ...classification,
      });

      activeUserTurnIndexRef.current = useLogStore.getState().turns.length - 1;
      activeAgentTurnIndexRef.current = null;
      agentTurnHasContentRef.current = false;
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      if (agentTurnHasContentRef.current) {
        return;
      }

      const { turns, updateTurnAt } = useLogStore.getState();
      const activeAgentTurnIndex = activeAgentTurnIndexRef.current;
      const activeAgentTurn =
        activeAgentTurnIndex !== null ? turns[activeAgentTurnIndex] : undefined;

      if (activeAgentTurn?.role === 'agent' && !activeAgentTurn.isFinal) {
        updateTurnAt(activeAgentTurnIndex!, {
          text,
          isFinal,
        });
        return;
      }

      createAgentTurn(text, isFinal);
    };

    // FIX: The 'content' event provides a single LiveServerContent object.
    const handleContent = (serverContent: LiveServerContent) => {
      const text =
        serverContent.modelTurn?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';
      const groundingChunks = serverContent.groundingMetadata?.groundingChunks;

      if (!text && !groundingChunks) return;

      const { guestLanguage, staffLanguage, lastGuestLanguage } = useSettings.getState();
      const { turns, updateTurnAt } = useLogStore.getState();
      const sourceTurn = resolveSourceTurn(turns, activeUserTurnIndexRef.current);
      const metadata = buildAgentTurnMetadata(
        sourceTurn,
        guestLanguage,
        staffLanguage,
        lastGuestLanguage,
      );
      const activeUserTurnIndex = activeUserTurnIndexRef.current;
      if (
        activeUserTurnIndex !== null &&
        sourceTurn?.role === 'user' &&
        !sourceTurn.detectedSpeaker &&
        metadata.detectedSpeaker === 'Staff'
      ) {
        updateTurnAt(activeUserTurnIndex, {
          detectedSpeaker: 'Staff',
          detectedLanguage: staffLanguage,
        });
      }
      const activeAgentTurnIndex = activeAgentTurnIndexRef.current;
      const activeAgentTurn =
        activeAgentTurnIndex !== null ? turns[activeAgentTurnIndex] : undefined;

      if (activeAgentTurn?.role === 'agent' && !activeAgentTurn.isFinal) {
        const updatedTurn: Partial<ConversationTurn> = {
          ...metadata,
        };

        if (text) {
          updatedTurn.text = agentTurnHasContentRef.current
            ? activeAgentTurn.text + text
            : text;
          agentTurnHasContentRef.current = true;
        }

        if (groundingChunks) {
          updatedTurn.groundingChunks = [
            ...(activeAgentTurn.groundingChunks || []),
            ...groundingChunks,
          ];
        }

        updateTurnAt(activeAgentTurnIndex!, updatedTurn);
        return;
      }

      createAgentTurn(text, false, groundingChunks, true);
    };

    const handleTurnComplete = () => {
      const { turns, updateTurnAt } = useLogStore.getState();
      const activeAgentTurnIndex = activeAgentTurnIndexRef.current;
      const activeUserTurnIndex = activeUserTurnIndexRef.current;

      const turnToFinalize =
        activeAgentTurnIndex !== null && turns[activeAgentTurnIndex]
          ? activeAgentTurnIndex
          : activeUserTurnIndex !== null && turns[activeUserTurnIndex]
            ? activeUserTurnIndex
            : null;

      if (turnToFinalize !== null && !turns[turnToFinalize].isFinal) {
        updateTurnAt(turnToFinalize, { isFinal: true });
      }

      const updatedTurns = useLogStore.getState().turns;

      if (user) {
        updateUserConversations(user.id, updatedTurns);
      }

      const finalAgentTurn =
        activeAgentTurnIndex !== null ? updatedTurns[activeAgentTurnIndex] : undefined;
      const correspondingUserTurn =
        activeUserTurnIndex !== null ? updatedTurns[activeUserTurnIndex] : undefined;

      if (finalAgentTurn?.role === 'agent' && finalAgentTurn.text && correspondingUserTurn?.text) {
        addHistoryItem({
          sourceText: correspondingUserTurn.text.trim(),
          translatedText: finalAgentTurn.text.trim(),
          lang1: correspondingUserTurn.detectedLanguage || AUTO_DETECT_LABEL,
          lang2: finalAgentTurn.detectedLanguage || AUTO_DETECT_LABEL,
        });
      }

      activeAgentTurnIndexRef.current = null;
      agentTurnHasContentRef.current = false;
    };
    const handleToolCall = (toolCall: LiveServerToolCall) => {
      const fc = toolCall.functionCalls.find(f => f.name === declaration.name);
      if (fc) {
        const { language } = fc.args as any;
        const normalizedLanguage = language ? normalizeLanguageValue(String(language)) : '';
        const settings = useSettings.getState();

        if (normalizedLanguage && normalizedLanguage !== settings.staffLanguage) {
          settings.setDetectedGuestLanguage(normalizedLanguage);

          const { turns, updateTurnAt } = useLogStore.getState();
          const userTurnIndex =
            activeUserTurnIndexRef.current ?? findLastUserTurnIndex(turns);

          if (userTurnIndex !== null) {
            updateTurnAt(userTurnIndex, {
              detectedSpeaker: 'Guest',
              detectedLanguage: normalizedLanguage,
            });
          }

          const agentTurnIndex = activeAgentTurnIndexRef.current;
          if (agentTurnIndex !== null && turns[agentTurnIndex]?.role === 'agent') {
            updateTurnAt(agentTurnIndex, {
              detectedSpeaker: 'Guest',
              detectedLanguage: settings.staffLanguage,
            });
          }
        }

        // Send response back to satisfy the client.
        client.sendToolResponse({
          functionResponses: toolCall.functionCalls.map(f => ({
            id: f.id,
            name: f.name,
            response: {
              success: Boolean(normalizedLanguage),
              language: normalizedLanguage,
            },
          })),
        });
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', handleContent);
    client.on('turncomplete', handleTurnComplete);
    client.on('toolcall', handleToolCall);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', handleContent);
      client.off('turncomplete', handleTurnComplete);
      client.off('toolcall', handleToolCall);
    };
  }, [client, addHistoryItem, user]);

  return (
    <div className="transcription-container">
      <WelcomeScreen />
    </div>
  );
}
