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

import { useEffect } from 'react';
import ControlTray from './components/console/control-tray/ControlTray';
import ErrorScreen from './components/demo/ErrorScreen';
import StreamingConsole from './components/demo/streaming-console/StreamingConsole';
import LoginModal from './components/auth/LoginModal';

import Header from './components/Header';
import Sidebar from './components/Sidebar';
import { LiveAPIProvider } from './contexts/LiveAPIContext';
import { useAuth, updateUserSettings } from './lib/auth';
import { useSettings } from './lib/state';

const API_KEY = process.env.API_KEY;
if (typeof API_KEY !== 'string') {
  throw new Error(
    'Missing required environment variable: API_KEY'
  );
}

/**
 * Main application component that provides a streaming interface for Live API.
 * Manages video streaming state and provides controls for webcam/screen capture.
 */
function App() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const unsub = useSettings.subscribe((state, prevState) => {
      const changes: Partial<{ systemPrompt: string; voice1: string; voice2: string }> = {};
      if (state.systemPrompt !== prevState.systemPrompt) {
        changes.systemPrompt = state.systemPrompt;
      }
      if (state.voice1 !== prevState.voice1) {
        changes.voice1 = state.voice1;
      }
      if (state.voice2 !== prevState.voice2) {
        changes.voice2 = state.voice2;
      }
      if (Object.keys(changes).length > 0) {
        updateUserSettings(user.id, changes);
      }
    });

    return () => unsub();
  }, [user]);

  if (!user) {
    return <LoginModal />;
  }

  return (
    <div className="App">
      <LiveAPIProvider apiKey={API_KEY}>
        <ErrorScreen />
        <Header />
        <Sidebar />
        <div className="streaming-console">
          <main>
            <div className="main-app-area">
              <StreamingConsole />
            </div>
            <ControlTray></ControlTray>
          </main>
        </div>
      </LiveAPIProvider>
    </div>
  );
}

export default App;