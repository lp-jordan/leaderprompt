import './ScriptViewer.css';
import leaderLogo from './assets/LeaderPass-Logo-white.png';

function ScriptViewer({ scriptHtml, showLogo, onSend }) {
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
