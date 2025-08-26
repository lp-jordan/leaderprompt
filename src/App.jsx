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
  const readAllFiles = async (handle) => {
    const files = [];
    if (!handle) return files;
    if (handle.kind === 'file' || handle.isFile) {
      const file = handle.getFile
        ? await handle.getFile()
        : await new Promise((res, rej) => handle.file(res, rej));
      files.push(file);
    } else if (handle.kind === 'directory' || handle.isDirectory) {
      if (handle.entries) {
        for await (const [, child] of handle.entries()) {
          files.push(...(await readAllFiles(child)));
        }
      } else if (handle.values) {
        for await (const child of handle.values()) {
          files.push(...(await readAllFiles(child)));
        }
      } else if (handle.createReader) {
        const reader = handle.createReader();
        const readEntries = () =>
          new Promise((resolve) => reader.readEntries(resolve));
        let entries = await readEntries();
        while (entries.length) {
          for (const entry of entries) {
            files.push(...(await readAllFiles(entry)));
          }
          entries = await readEntries();
        }
      }
    }
    return files;
  };

  const parseDataTransferItems = async (dataTransfer) => {
    const items = Array.from(dataTransfer?.items || []);
    const folders = [];
    const files = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      let handle = null;
      if (item.getAsFileSystemHandle) {
        try {
          handle = await item.getAsFileSystemHandle();
        } catch {
          handle = null;
        }
      } else if (item.webkitGetAsEntry) {
        handle = item.webkitGetAsEntry();
      }
      if (handle && (handle.kind === 'directory' || handle.isDirectory)) {
        const dirFiles = await readAllFiles(handle);
        folders.push({ name: handle.name, files: dirFiles });
        files.push(...dirFiles);
      } else {
        const file = item.getAsFile
          ? item.getAsFile()
          : handle?.getFile
            ? await handle.getFile()
            : null;
        if (file) files.push(file);
      }
    }
    return { folders, files };
  };

  const handleLeftDragEnter = (e) => {
    if (e.target.closest?.('.file-manager')) return;
    if (e.dataTransfer?.types?.includes('Files')) setLeftDrag(true);
    parseDataTransferItems(e.dataTransfer)
      .then(({ folders }) => {
        if (folders.length > 0 || e.dataTransfer.files?.length) {
          setLeftDrag(true);
        } else {
          setLeftDrag(false);
        }
      })
      .catch((err) => {
        console.error('Error parsing drag items', err);
        if (e.dataTransfer.files?.length) {
          setLeftDrag(true);
        } else {
          setLeftDrag(false);
        }
      });
  };

  const handleLeftDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setLeftDrag(false);
  };

  const handleLeftDrop = async (e) => {
    e.preventDefault();
    if (e.target.closest?.('.file-manager')) return;
    setLeftDrag(false);
    const { folders, files } = await parseDataTransferItems(e.dataTransfer);
    const docxFiles = files.filter((f) =>
      f.name.toLowerCase().endsWith('.docx'),
    );
    if (folders.length) {
      if (!window.electronAPI?.importFoldersDataAsProjects) {
        console.error('electronAPI unavailable');
        return;
      }
      const payload = await Promise.all(
        folders.map(async (f) => ({
          name: f.name,
          files: await Promise.all(
            f.files
              .filter((file) => file.name.toLowerCase().endsWith('.docx'))
              .map(async (file) => ({
                name: file.name,
                data: await file.arrayBuffer(),
              })),
          ),
        })),
      );
      await window.electronAPI.importFoldersDataAsProjects(payload);
      if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
      toast.success('Projects imported');
    } else if (docxFiles.length) {
      const projectName = 'Quick Scripts';
      if (!window.electronAPI?.importFilesToProject) {
        console.error('electronAPI unavailable');
        toast.error('Unable to import scripts');
        return;
      }
      const payload = await Promise.all(
        docxFiles.map(async (file) => ({
          name: file.name,
          data: await file.arrayBuffer(),
        })),
      );
      await window.electronAPI.importFilesToProject(payload, projectName);
      if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
      toast.success('Scripts imported');
    } else if (files.length) {
      toast.error('Only .docx files can be imported');
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
            onRootDragStateChange={setLeftDrag}
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
