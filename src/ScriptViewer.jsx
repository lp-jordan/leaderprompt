import './ScriptViewer.css';
import leaderLogo from './assets/LeaderPass-Logo-white.png';
import { useEffect, useRef } from 'react';

function ScriptViewer({ scriptHtml, showLogo, onSend, onEdit }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (contentRef.current && scriptHtml) {
      contentRef.current.innerHTML = scriptHtml;
      window.electronAPI.sendUpdatedScript(scriptHtml);
    }
  }, [scriptHtml]);

  const handleBlur = () => {
    if (contentRef.current) {
      onEdit(contentRef.current.innerHTML);
    }
  };
  
  return (
    <div className="script-viewer">
      {showLogo ? (
        <div className="logo-wrapper">
          <img src={leaderLogo} alt="LeaderPrompt Logo" className="viewer-logo" />
        </div>
      ) : (
        <>
          <div
            ref={contentRef}
            className="script-content"
            contentEditable
            onBlur={handleBlur}
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
