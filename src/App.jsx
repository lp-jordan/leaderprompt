import './App.css';
import { useState, useRef } from 'react';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';

function App() {
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadedScript, setLoadedScript] = useState(null);
  const [loadedProject, setLoadedProject] = useState(null);
  const [scriptHtml, setScriptHtml] = useState(null);
  const [leftWidth, setLeftWidth] = useState(300);
  const leftRef = useRef(null);
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

  const handleScriptEdit = (html) => {
    setScriptHtml(html);
    if (
      selectedProject === loadedProject &&
      selectedScript === loadedScript
    ) {
      window.electronAPI.sendUpdatedScript(html);
    }
  };

  const handleCloseScript = () => {
    setScriptHtml(null);
  };

  return (
    <div className="main-layout">
      <div className="left-panel" ref={leftRef} style={{ width: leftWidth }}>
        <FileManager
          onScriptSelect={handleScriptSelect}
          loadedProject={loadedProject}
          loadedScript={loadedScript}
        />
      </div>
      <div className="divider" onMouseDown={startDrag} />
      <div className="right-panel">
        <ScriptViewer
          scriptHtml={scriptHtml}
          showLogo={!scriptHtml}
          onSend={handleSendToPrompter}
          onEdit={handleScriptEdit}
          onClose={handleCloseScript}
        />
      </div>
    </div>
  );
}

export default App;
