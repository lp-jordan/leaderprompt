import './App.css';
import _leaderLogo from './assets/LeaderPass-Logo-white.png';
import { useState } from 'react';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';
import mammoth from 'mammoth';

function App() {
  const [_selectedScript, setSelectedScript] = useState(null);
  const [_selectedProject, setSelectedProject] = useState(null);
  const [scriptHtml, setScriptHtml] = useState(null);

  const handleScriptSelect = async (projectName, scriptName) => {
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
    try {
      const scriptPath = `C:/Users/LeaderPass 1/LeaderPrompt/projects/${projectName}/${scriptName}`;
      const response = await fetch(`file://${scriptPath}`);
      const arrayBuffer = await response.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setScriptHtml(result.value);
    } catch (err) {
      console.error('Failed to load script:', err);
    }
  };

  const handleSendToPrompter = () => {
    if (scriptHtml) {
      window.electronAPI.openPrompter(scriptHtml);
    }
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
        />
      </div>
    </div>
  );
}

export default App;
