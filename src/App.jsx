import './App.css';
import { useState, useRef, useEffect } from 'react';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';
import leaderLogo from './assets/LeaderPass-Logo-white.png';

function App() {
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadedScript, setLoadedScript] = useState(null);
  const [loadedProject, setLoadedProject] = useState(null);
  const [scriptHtml, setScriptHtml] = useState(null);
  const [leftWidth, setLeftWidth] = useState(300);
  const leftRef = useRef(null);
  const fileManagerRef = useRef(null);
  const isDragging = useRef(false);
  const saveTimeout = useRef(null);

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

  const handleScriptSelect = async (projectName, scriptName) => {
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
    try {
      const html = await window.electronAPI.loadScript(projectName, scriptName);
      setScriptHtml(html);
    } catch (err) {
      console.error('Failed to load script:', err);
    }
  };

  const handleSendToPrompter = () => {
    if (scriptHtml) {
      window.electronAPI.openPrompter(scriptHtml);
      setLoadedProject(selectedProject);
      setLoadedScript(selectedScript);
    }
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      setLoadedProject(null);
      setLoadedScript(null);
    });
    return () => {
      cleanup?.();
    };
  }, []);

  const handleScriptEdit = (html) => {
    setScriptHtml(html);
    if (selectedProject && selectedScript) {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
      saveTimeout.current = setTimeout(() => {
        window.electronAPI.saveScript(selectedProject, selectedScript, html);
        saveTimeout.current = null;
      }, 300);
    }
    if (
      selectedProject === loadedProject &&
      selectedScript === loadedScript
    ) {
      window.electronAPI.sendUpdatedScript(html);
    }
  };

  const handleCloseScript = () => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (selectedProject && selectedScript && scriptHtml) {
      window.electronAPI.saveScript(
        selectedProject,
        selectedScript,
        scriptHtml,
      );
    }
    setScriptHtml(null);
    setSelectedProject(null);
    setSelectedScript(null);
    setLoadedProject(null);
    setLoadedScript(null);
    window.electronAPI.sendUpdatedScript('');
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
          scriptHtml={scriptHtml}
          scriptName={selectedScript}
          showLogo={scriptHtml === null}
          onSend={handleSendToPrompter}
          onEdit={handleScriptEdit}
          onClose={handleCloseScript}
          onCreate={handleCreateRequest}
          onLoad={handleLoadRequest}
        />
      </div>
      <img src={leaderLogo} alt="LeaderPrompt Logo" className="main-logo" />
    </div>
  );
}

export default App;
