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
  const [leftWidth, setLeftWidth] = useState(300);
  const leftRef = useRef(null);
  const fileManagerRef = useRef(null);
  const isDragging = useRef(false);

  const onDrag = (e) => {
    if (!isDragging.current) return;
    const newWidth = Math.min(
      Math.max(150, e.clientX),
      window.innerWidth - 150,
    );
    if (leftRef.current) {
      leftRef.current.style.width = `${newWidth}px`;
    }
  };

  const stopDrag = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
    if (leftRef.current) {
      setLeftWidth(parseInt(leftRef.current.style.width, 10));
    }
  };

  const startDrag = () => {
    isDragging.current = true;
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  };

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

  const handleCreateRequest = () => {
    fileManagerRef.current?.newScript();
  };

  const handleLoadRequest = async () => {
    console.log('Load request ignored: popups removed');
  };

  return (
    <div className="main-layout">
      <div className="left-panel" ref={leftRef} style={{ width: leftWidth }}>
        <FileManager
          ref={fileManagerRef}
          onScriptSelect={handleScriptSelect}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
          currentProject={selectedProject}
          currentScript={selectedScript}
        />
      </div>
      <div className="divider" onMouseDown={startDrag} />
      <div className="right-panel">
        <ScriptViewer
          projectName={selectedProject}
          scriptName={selectedScript}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
          onPrompterOpen={handlePrompterOpen}
          onPrompterClose={handlePrompterClose}
          onCloseViewer={handleViewerClose}
          onCreate={handleCreateRequest}
          onLoad={handleLoadRequest}
        />
      </div>
      <img src={leaderLogo} alt="LeaderPrompt Logo" className="main-logo" />
    </div>
  );
}

export default App;
