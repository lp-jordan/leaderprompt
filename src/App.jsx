import './App.css';
import { useState, useRef } from 'react';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';
import leaderLogo from './assets/LeaderPass-Logo-white.png';

function App() {
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadedScript, setLoadedScript] = useState(null);
  const [loadedProject, setLoadedProject] = useState(null);
  const fileManagerRef = useRef(null);
  const [sendCallback, setSendCallback] = useState(null);
  const [closeCallback, setCloseCallback] = useState(null);
  const [viewerLoaded, setViewerLoaded] = useState(false);

  const handleScriptSelect = (projectName, scriptName) => {
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
  };

  const handlePrompterOpen = (projectName, scriptName) => {
    setLoadedProject(projectName);
    setLoadedScript(scriptName);
  };

  const handlePrompterClose = () => {
    setLoadedProject(null);
    setLoadedScript(null);
  };

  const handleViewerClose = () => {
    setSelectedProject(null);
    setSelectedScript(null);
  };


  return (
    <div className="main-layout">
      <div className="left-panel">
        <FileManager
          ref={fileManagerRef}
          onScriptSelect={handleScriptSelect}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
          currentProject={selectedProject}
          currentScript={selectedScript}
        />
      </div>
      <div className="right-panel">
        <ScriptViewer
          projectName={selectedProject}
          scriptName={selectedScript}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
          onPrompterOpen={handlePrompterOpen}
          onPrompterClose={handlePrompterClose}
          onCloseViewer={handleViewerClose}
          onLoadedChange={setViewerLoaded}
          onClose={(cb) => {
            setCloseCallback(() => cb);
          }}
          onSend={(cb) => {
            setSendCallback(() => cb);
          }}
        />
          {(closeCallback || sendCallback) && (
            <div className="send-button-container">
              {closeCallback && (
                <button
                  className="send-button"
                  onClick={() => closeCallback && closeCallback()}
                >
                  Close
                </button>
              )}
              {sendCallback && (
                <button
                  className="send-button"
                  onClick={() => sendCallback && sendCallback()}
                  disabled={!sendCallback}
                >
                  Let&apos;s Go!
                </button>
              )}
            </div>
      </div>
      {!viewerLoaded && (
        <div className="load-placeholder">
          Welcome to LeaderPrompt. Please load or create a script.
        </div>
          )}
        <img src={leaderLogo} alt="LeaderPrompt Logo" className="main-logo" />
      )}
    </div>
  );
}

export default App;
