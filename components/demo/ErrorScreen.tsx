/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useLiveAPIContext } from '../../contexts/LiveAPIContext';
import React, { useEffect, useState } from 'react';

import { useSettings } from '../../lib/state';

export interface ExtendedErrorType {
  code?: string;
  message?: string;
  status?: string;
}

export default function ErrorScreen({ forceMissingKey = false }: { forceMissingKey?: boolean }) {
  const { client } = useLiveAPIContext();
  const { setApiKey } = useSettings();
  const [error, setError] = useState<{ message?: string } | null>(null);
  const [tempKey, setTempKey] = useState('');

  useEffect(() => {
    function onError(error: ErrorEvent) {
      console.error(error);
      setError(error);
    }

    client.on('error', onError);

    return () => {
      client.off('error', onError);
    };
  }, [client]);

  const quotaErrorMessage =
    'Gemini Live API in AI Studio has a limited free quota each day. Come back tomorrow to continue.';

  let errorMessage = 'Something went wrong. Please try again.';
  let rawMessage: string | null = error?.message || null;
  let tryAgainOption = true;
  if (error?.message?.includes('RESOURCE_EXHAUSTED')) {
    errorMessage = quotaErrorMessage;
    rawMessage = null;
    tryAgainOption = false;
  }

  if (forceMissingKey) {
    return (
      <div className="error-screen eburon-standard">
        <div className="eburon-glow"></div>
        <div className="eburon-content">
          <div className="eburon-badge">EBRN_KEY_MISSING</div>
          <h1 className="eburon-title">API Key Missing</h1>
          <p className="eburon-desc">
            To start using Dual Translator, please provide your Gemini API key.
            The key is stored locally in your session.
          </p>
          
          <div className="eburon-input-group">
            <input 
              type="password" 
              placeholder="Paste your API key here..." 
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              className="eburon-input"
            />
            <button 
              className="eburon-submit"
              onClick={() => setApiKey(tempKey)}
              disabled={!tempKey.trim()}
            >
              Enable Access
            </button>
          </div>
          
          <div className="eburon-footer">
            Need a key? <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer noopener">Get one from Google AI Studio</a>
          </div>
        </div>
      </div>
    );
  }

  if (!error) {
    return null;
  }

  return (
    <div className="error-screen eburon-standard generic">
      <div className="eburon-content">
        <div className="eburon-badge">EBRN_INTERNAL</div>
        <div className="eburon-icon">💔</div>
        <div className="eburon-desc">{errorMessage}</div>
        {tryAgainOption ? (
          <button
            className="eburon-submit secondary"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        ) : null}
        {rawMessage ? (
          <pre className="eburon-raw-log">{rawMessage}</pre>
        ) : null}
      </div>
    </div>
  );
}
