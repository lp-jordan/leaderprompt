import './App.css';
import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
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
  const [leftDrag, setLeftDrag] = useState(false);

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

  const handleLeftDragOver = (e) => {
    e.preventDefault();
  };

  const parseDataTransferItems = async (dataTransfer) => {
    const items = Array.from(dataTransfer?.items || []);
    const folderPaths = [];
    const filePaths = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      let entry = null;
      if (item.webkitGetAsEntry) {
        entry = item.webkitGetAsEntry();
      } else if (item.getAsFileSystemHandle) {
        try {
          entry = await item.getAsFileSystemHandle();
        } catch {
          entry = null;
        }
      }
      const file = item.getAsFile?.();
      const path = file?.path;
      if (!path) continue;
      if (entry?.isDirectory) folderPaths.push(path);
      else filePaths.push(path);
    }
    return { folderPaths, filePaths };
  };

  const handleLeftDragEnter = (e) => {
    if (e.target.closest?.('.file-manager')) return;
    parseDataTransferItems(e.dataTransfer).then(({ folderPaths }) => {
      setLeftDrag(folderPaths.length > 0);
    });
  };

  const handleLeftDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setLeftDrag(false);
  };

  const handleLeftDrop = async (e) => {
    e.preventDefault();
    if (e.target.closest?.('.file-manager')) return;
    setLeftDrag(false);
    const { folderPaths, filePaths } = await parseDataTransferItems(
      e.dataTransfer,
    );
    const docxPaths = filePaths.filter((p) => p?.toLowerCase().endsWith('.docx'));
    if (folderPaths.length) {
      if (!window.electronAPI?.importFoldersAsProjects) {
        console.error('electronAPI unavailable');
        return;
      }
      await window.electronAPI.importFoldersAsProjects(folderPaths);
      if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
      toast.success('Projects imported');
    } else if (filePaths.length) {
      const projectName = 'Quick Scripts';
      if (!window.electronAPI?.importScriptsToProject) {
        console.error('electronAPI unavailable');
        toast.error('Unable to import scripts');
        return;
      }
      if (!docxPaths.length) {
        toast.error('Only .docx files can be imported');
        return;
      }
      await window.electronAPI.importScriptsToProject(docxPaths, projectName);
      if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
      toast.success('Scripts imported');
    }
  };

  return (
    <div className="main-layout">
      <div
        className={`left-panel ${showFileManager ? '' : 'collapsed'}${leftDrag ? ' drop-target' : ''}`}
        onDragOver={handleLeftDragOver}
        onDragEnter={handleLeftDragEnter}
        onDragLeave={handleLeftDragLeave}
        onDrop={handleLeftDrop}
      >
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
