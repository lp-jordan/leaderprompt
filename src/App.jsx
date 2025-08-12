import './App.css';
import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [showFileManager, setShowFileManager] = useState(() => window.innerWidth >= 1000);

  useEffect(() => {
    const handleResize = () => {
      setShowFileManager(window.innerWidth >= 700);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleScriptSelect = (projectName, scriptName) => {
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
  };

  const handlePrompterOpen = useCallback(
    (projectName, scriptName) => {
      setLoadedProject(projectName);
      setLoadedScript(scriptName);
    },
    [setLoadedProject, setLoadedScript],
  );

  const handlePrompterClose = useCallback(() => {
    setLoadedProject(null);
    setLoadedScript(null);
  }, [setLoadedProject, setLoadedScript]);

  const handleViewerClose = useCallback(() => {
    setSelectedProject(null);
    setSelectedScript(null);
  }, [setSelectedProject, setSelectedScript]);

  const updateCloseCallback = useCallback((cb) => {
    setCloseCallback(() => cb);
  }, [setCloseCallback]);

  const updateSendCallback = useCallback((cb) => {
    setSendCallback(() => cb);
  }, [setSendCallback]);

  return (
    <div className="main-layout">
      <div className={`left-panel ${showFileManager ? '' : 'collapsed'}`}>
        {showFileManager && (
          <FileManager
            ref={fileManagerRef}
            onScriptSelect={handleScriptSelect}
            loadedProject={loadedProject}
            loadedScript={loadedScript}
            currentProject={selectedProject}
            currentScript={selectedScript}
          />
        )}
      </div>

      <div className="right-panel">
        {!viewerLoaded && (
          <div className="load-placeholder">
            Welcome to LeaderPrompt. Please load or create a script.
          </div>
        )}

        <ScriptViewer
          projectName={selectedProject}
          scriptName={selectedScript}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
          onPrompterOpen={handlePrompterOpen}
          onPrompterClose={handlePrompterClose}
          onCloseViewer={handleViewerClose}
          onLoadedChange={setViewerLoaded}
          onClose={updateCloseCallback}
          onSend={updateSendCallback}
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
        )}
      </div>

      <img src={leaderLogo} alt="LeaderPrompt Logo" className="main-logo" />
    </div>
  );
}

export default App;
