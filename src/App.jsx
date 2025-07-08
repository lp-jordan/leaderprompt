import './App.css';
import { useState } from 'react';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';

function App() {
  const [_selectedScript, setSelectedScript] = useState(null);
  const [_selectedProject, setSelectedProject] = useState(null);
  const [scriptHtml, setScriptHtml] = useState(null);

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
    }
  };

  const handleScriptEdit = (html) => {
    setScriptHtml(html);
  };

  return (
    <div className="main-layout">
      <div className="left-panel">
        <FileManager onScriptSelect={handleScriptSelect} />
      </div>
      <div className="right-panel">
        <ScriptViewer
          scriptHtml={scriptHtml}
          showLogo={!scriptHtml}
          onSend={handleSendToPrompter}
          onEdit={handleScriptEdit}
        />
      </div>
    </div>
  );
}

export default App;
