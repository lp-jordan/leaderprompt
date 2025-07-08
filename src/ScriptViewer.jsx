import './ScriptViewer.css';
import leaderLogo from './assets/LeaderPass-Logo-white.png';
import { useEffect, useRef } from 'react';

function ScriptViewer({ scriptHtml, showLogo, onSend, onEdit, onClose }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (contentRef.current && scriptHtml) {
      contentRef.current.innerHTML = scriptHtml;
    }
  }, [scriptHtml]);

  const handleBlur = () => {
    if (contentRef.current) {
      onEdit(contentRef.current.innerHTML);
    }
  };
  
  return (
      <div className="script-viewer">
        <div className="viewer-header">

          <div className="header-left">
            {!showLogo && <h2 className="header-title">Script Editor</h2>}
            {!showLogo && (
              <button className="close-button" onClick={onClose}>
                Close
              </button>
            )}
          </div>
          <img src={leaderLogo} alt="LeaderPrompt Logo" className="header-logo" />
        </div>
        {showLogo ? (
          <div className="load-placeholder">Please load a script</div>
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
