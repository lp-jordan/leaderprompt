import './ScriptViewer.css';
import leaderLogo from './assets/LeaderPass-Logo-white.png';
import { useEffect, useRef } from 'react';
function ScriptViewer({
  scriptHtml,
  scriptName,
  showLogo,
  onSend,
  onEdit,
  onClose,
  onCreate,
  onLoad,
}) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (
      contentRef.current &&
      scriptHtml !== null &&
      contentRef.current.innerHTML !== scriptHtml
    ) {
      contentRef.current.innerHTML = scriptHtml;
    }
  }, [scriptHtml]);

  const handleBlur = () => {
    if (contentRef.current) {
      onEdit(contentRef.current.innerHTML);
    }
  };

  const handleInput = () => {
    if (contentRef.current) {
      onEdit(contentRef.current.innerHTML);
    }
  };
  
  return (
    <div className="script-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2 className="header-title">Script Viewer</h2>
        </div>
        <img src={leaderLogo} alt="LeaderPrompt Logo" className="header-logo" />
      </div>
      {scriptName && (
        <div className="script-name-row">
          <div className="script-name">
            {scriptName.replace(/\.[^/.]+$/, '')}
          </div>
          <button
            className="close-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
      {showLogo ? (
        <div className="load-placeholder">
          Please{' '}
          <button className="link-button" onClick={onLoad}>
            Load
          </button>{' '}
          or{' '}
          <button className="link-button" onClick={onCreate}>
            Create
          </button>{' '}
          a Script
        </div>
      ) : (
        <>
          <div
            ref={contentRef}
            className="script-content"
            contentEditable
            onBlur={handleBlur}
            onInput={handleInput}
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
