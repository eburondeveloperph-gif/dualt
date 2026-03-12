/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GenAILiveClient } from '../../lib/genai-live-client';
import { LiveConnectConfig } from '@google/genai';
import { AudioStreamer } from '../../lib/audio-streamer';
import { audioContext } from '../../lib/utils';
import VolMeterWorket from '../../lib/worklets/vol-meter';
import { useSettings } from '../../lib/state';

export type UseLiveApiResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;

  connect: () => Promise<void>;
  disconnect: () => void;
  connected: boolean;

  volume: number;
  isAgentSpeaking: boolean;
  isTtsMuted: boolean;
  toggleTtsMute: () => void;
};

const SPEAKING_COOLDOWN_MS = 350;

export function useLiveApi({
  apiKey,
}: {
  apiKey: string;
}): UseLiveApiResults {
  const { model, resetSessionLanguageState } = useSettings();
  const client = useMemo(() => new GenAILiveClient(apiKey, model), [apiKey, model]);

  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [volume, setVolume] = useState(0);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isTtsMuted, setIsTtsMuted] = useState(false);
  const speakingCooldownRef = useRef<number | null>(null);
  const agentTurnActiveRef = useRef(false);
  const agentTurnCompleteRef = useRef(true);
  const agentAudioPendingRef = useRef(false);

  const clearSpeakingCooldown = useCallback(() => {
    if (speakingCooldownRef.current !== null) {
      window.clearTimeout(speakingCooldownRef.current);
      speakingCooldownRef.current = null;
    }
  }, []);

  const markAgentSpeaking = useCallback(() => {
    clearSpeakingCooldown();
    setIsAgentSpeaking(true);
  }, [clearSpeakingCooldown]);

  const markAgentSilent = useCallback(
    (cooldownMs = 0) => {
      clearSpeakingCooldown();
      if (cooldownMs <= 0) {
        setIsAgentSpeaking(false);
        return;
      }

      speakingCooldownRef.current = window.setTimeout(() => {
        setIsAgentSpeaking(false);
        speakingCooldownRef.current = null;
      }, cooldownMs) as unknown as number;
    },
    [clearSpeakingCooldown]
  );

  const clearAgentTurnRefs = useCallback(() => {
    agentTurnActiveRef.current = false;
    agentTurnCompleteRef.current = true;
    agentAudioPendingRef.current = false;
  }, []);

  const finishAgentTurnIfReady = useCallback(
    (cooldownMs = 0) => {
      if (!agentTurnActiveRef.current) {
        return;
      }

      if (!agentTurnCompleteRef.current || agentAudioPendingRef.current) {
        return;
      }

      clearAgentTurnRefs();
      markAgentSilent(cooldownMs);
    },
    [clearAgentTurnRefs, markAgentSilent]
  );

  const markAgentTurnActive = useCallback(
    ({ hasAudio = false }: { hasAudio?: boolean } = {}) => {
      agentTurnActiveRef.current = true;
      agentTurnCompleteRef.current = false;
      if (hasAudio) {
        agentAudioPendingRef.current = true;
      }
      markAgentSpeaking();
    },
    [markAgentSpeaking]
  );

  const markAgentAudioComplete = useCallback(() => {
    agentAudioPendingRef.current = false;
    finishAgentTurnIfReady(SPEAKING_COOLDOWN_MS);
  }, [finishAgentTurnIfReady]);

  const markAgentTurnComplete = useCallback(() => {
    agentTurnCompleteRef.current = true;
    finishAgentTurnIfReady(SPEAKING_COOLDOWN_MS);
  }, [finishAgentTurnIfReady]);

  const resetAgentTurnState = useCallback(() => {
    clearAgentTurnRefs();
    markAgentSilent();
  }, [clearAgentTurnRefs, markAgentSilent]);

  const toggleTtsMute = useCallback(() => {
    setIsTtsMuted(prev => {
      const newMuted = !prev;
      if (audioStreamerRef.current) {
        audioStreamerRef.current.gainNode.gain.value = newMuted ? 0 : 1;
      }
      return newMuted;
    });
  }, []);

  useEffect(() => {
    return () => {
      clearSpeakingCooldown();
    };
  }, [clearSpeakingCooldown]);

  // register audio for streaming server -> speakers
  useEffect(() => {
    let isMounted = true;

    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' }).then((audioCtx: AudioContext) => {
        if (!isMounted) return;

        const streamer = new AudioStreamer(audioCtx);
        streamer.onComplete = () => {
          markAgentAudioComplete();
        };
        audioStreamerRef.current = streamer;
        streamer
          .addWorklet<any>('vumeter-out', VolMeterWorket, (ev: any) => {
            setVolume(ev.data.volume);
          })
          .then(() => {
            // Successfully added worklet
          })
          .catch(err => {
            console.error('Error adding worklet:', err);
          });
      });
    }

    return () => {
      isMounted = false;
    };
  }, [audioStreamerRef, markAgentAudioComplete]);

  useEffect(() => {
    const onOpen = () => {
      setConnected(true);
    };

    const onClose = () => {
      setConnected(false);
      resetAgentTurnState();
    };

    const stopAudioStreamer = () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
      resetAgentTurnState();
    };

    const onAudio = (data: ArrayBuffer) => {
      markAgentTurnActive({ hasAudio: true });
      if (audioStreamerRef.current) {
        audioStreamerRef.current.addPCM16(new Uint8Array(data));
      }
    };

    const onOutputTranscription = () => {
      markAgentTurnActive();
    };

    const onContent = () => {
      markAgentTurnActive();
    };

    const onTurnComplete = () => {
      markAgentTurnComplete();
    };

    // Bind event listeners
    client.on('open', onOpen);
    client.on('close', onClose);
    client.on('interrupted', stopAudioStreamer);
    client.on('audio', onAudio);
    client.on('outputTranscription', onOutputTranscription);
    client.on('content', onContent);
    client.on('turncomplete', onTurnComplete);

    return () => {
      // Clean up event listeners
      client.off('open', onOpen);
      client.off('close', onClose);
      client.off('interrupted', stopAudioStreamer);
      client.off('audio', onAudio);
      client.off('outputTranscription', onOutputTranscription);
      client.off('content', onContent);
      client.off('turncomplete', onTurnComplete);
    };
  }, [client, markAgentTurnActive, markAgentTurnComplete, resetAgentTurnState]);

  const connect = useCallback(async () => {
    if (!config) {
      throw new Error('config has not been set');
    }
    client.disconnect();
    resetSessionLanguageState();
    await client.connect(config);
  }, [client, config, resetSessionLanguageState]);

  const disconnect = useCallback(async () => {
    client.disconnect();
    if (audioStreamerRef.current) {
      audioStreamerRef.current.stop();
    }
    resetSessionLanguageState();
    resetAgentTurnState();
    setConnected(false);
  }, [setConnected, client, resetAgentTurnState, resetSessionLanguageState]);

  return {
    client,
    config,
    setConfig,
    connect,
    connected,
    disconnect,
    volume,
    isAgentSpeaking,
    isTtsMuted,
    toggleTtsMute,
  };
}
