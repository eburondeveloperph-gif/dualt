/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import './PopUp.css';

interface PopUpProps {
  onClose: () => void;
}

const PopUp: React.FC<PopUpProps> = ({ onClose }) => {
  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <h2>Welcome to Dual Translator</h2>
        <p>Your starting point for real-time speech translation with Gemini Live.</p>
        <p>To get started:</p>
        <ol>
          <li><span className="icon">play_circle</span>Press Play to start live listening and translation.</li>
          <li><span className="icon">save_as</span>Copy this sandbox to create your own version.</li>
          <li><span className="icon">auto_awesome</span>Use the Code Assistant to customize and test your creation.</li>
        </ol>
        <button onClick={onClose}>Start Building</button>
      </div>
    </div>
  );
};

export default PopUp;
