import './ScriptViewer.css';
import leaderLogo from './assets/LeaderPass-Logo-white.png';
import { useEffect } from 'react';

function ScriptViewer({ scriptHtml, showLogo, onSend, onEdit }) {
<<<<<<< HEAD
=======
  useEffect(() => {
    if (scriptHtml) {
      window.electronAPI.sendUpdatedScript(scriptHtml);
    }
  }, [scriptHtml]);
  
>>>>>>> bb94cead8c26cb9a8b3cbdf5801d05e5971c09ce
  return (
    <div className="script-viewer">
      {showLogo ? (
        <div className="logo-wrapper">
          <img src={leaderLogo} alt="LeaderPrompt Logo" className="viewer-logo" />
        </div>
      ) : (
        <>
          <div
            className="script-content"
            contentEditable
            onInput={(e) => onEdit(e.currentTarget.innerHTML)}
            dangerouslySetInnerHTML={{ __html: scriptHtml }}
          />
          <div className="send-button-wrapper">
            <button className="send-button" onClick={onSend}>
              Let&apos;s Go!
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ScriptViewer;
