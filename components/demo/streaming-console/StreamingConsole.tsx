
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import WelcomeScreen from '../welcome-screen/WelcomeScreen';
// FIX: Import LiveServerContent to correctly type the content handler.
import { Modality, LiveServerContent, LiveServerToolCall } from '@google/genai';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  useSettings,
  useLogStore,
  ConversationTurn,
  declaration,
} from '../../../lib/state';
import { useHistoryStore } from '../../../lib/history';
import { useAuth, updateUserConversations, fetchUserConversations } from '../../../lib/auth';

const AUTO_DETECT_LABEL = 'Auto Detect';

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
    // Using `any` for config to accommodate `speechConfig`, which is not in the
    // current TS definitions but is used in the working reference example.
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
      tools: [
        { functionDeclarations: [declaration] }
      ],
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
      const { turns, addTurn, updateTurnAt } = useLogStore.getState();
      const activeUserTurnIndex = activeUserTurnIndexRef.current;
      const activeUserTurn =
        activeUserTurnIndex !== null ? turns[activeUserTurnIndex] : undefined;

      if (activeUserTurn?.role === 'user' && !activeUserTurn.isFinal) {
        updateTurnAt(activeUserTurnIndex!, {
          text: activeUserTurn.text + text,
          isFinal,
        });
        return;
      }

      addTurn({
        role: 'user',
        text,
        isFinal,
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
          text: activeAgentTurn.text + text,
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
      const fc = toolCall.functionCalls.find(f => f.name === 'report_guest_language');
      if (fc) {
        const { language } = fc.args as any;
        if (language) {
          const settings = useSettings.getState();
          settings.setLastGuestLanguage(language);

          const { turns, updateTurnAt } = useLogStore.getState();
          const userTurnIndex =
            activeUserTurnIndexRef.current ?? findLastUserTurnIndex(turns);

          if (userTurnIndex !== null) {
            updateTurnAt(userTurnIndex, {
              detectedSpeaker: 'Guest',
              detectedLanguage: language,
            });
          }

          const agentTurnIndex = activeAgentTurnIndexRef.current;
          if (agentTurnIndex !== null && turns[agentTurnIndex]?.role === 'agent') {
            updateTurnAt(agentTurnIndex, {
              detectedSpeaker: 'Guest',
              detectedLanguage: settings.staffLanguage,
            });
          }

          // Send response back to satisfy the client
          client.sendToolResponse({
            functionResponses: toolCall.functionCalls.map(f => ({
              id: f.id,
              response: { output: { success: true } }
            }))
          });
        }
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
