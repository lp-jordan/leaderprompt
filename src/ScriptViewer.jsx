import './ScriptViewer.css';
import { useEffect, useRef, useState, useCallback } from 'react';

function ScriptViewer({
  projectName,
  scriptName,
  loadedProject,
  loadedScript,
  onPrompterOpen,
  onPrompterClose,
  onCloseViewer,
  onSend,
}) {
  const [scriptHtml, setScriptHtml] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const contentRef = useRef(null);
  const saveTimeout = useRef(null);

useEffect(() => {
  let cancelled = false;
  if (projectName && scriptName) {
    setLoaded(false);
    window.electronAPI
      .loadScript(projectName, scriptName)
      .then((html) => {
        if (!cancelled) {
          setScriptHtml(html);
          setLoaded(true);
        }
      })
      .catch((err) => {
        console.error('Failed to load script:', err);
      });
  } else {
    setScriptHtml(null);
    setLoaded(false);
    window.electronAPI.sendUpdatedScript('');
    // ✅ Fallback clear
    if (contentRef.current) {
      contentRef.current.innerHTML = '';
    }
  }
  return () => {
    cancelled = true;
  };
}, [projectName, scriptName]);

  useEffect(() => {
    if (contentRef.current) {
      if (scriptHtml !== null && contentRef.current.innerHTML !== scriptHtml) {
        contentRef.current.innerHTML = scriptHtml;
      } else if (scriptHtml === null) {
        contentRef.current.innerHTML = '';
      }
    }
  }, [scriptHtml]);

  const handleEdit = (html) => {
    setScriptHtml(html);
    if (projectName && scriptName) {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
      saveTimeout.current = setTimeout(() => {
        window.electronAPI.saveScript(projectName, scriptName, html);
        saveTimeout.current = null;
      }, 300);
    }
    if (projectName === loadedProject && scriptName === loadedScript) {
      window.electronAPI.sendUpdatedScript(html);
    }
  };

  const handleBlur = () => {
    if (contentRef.current) {
      handleEdit(contentRef.current.innerHTML);
    }
  };

  const handleInput = () => {
    if (contentRef.current) {
      handleEdit(contentRef.current.innerHTML);
    }
  };

  const handleSend = useCallback(() => {
    window.electronAPI.openPrompter(scriptHtml || '');
    onPrompterOpen?.(projectName, scriptName);
  }, [scriptHtml, projectName, scriptName, onPrompterOpen]);

  useEffect(() => {
    onSend?.(loaded && scriptHtml?.trim() ? () => handleSend() : null);
  }, [onSend, handleSend, loaded]);

  useEffect(() => {
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      onPrompterClose?.();
    });
    return () => {
      cleanup?.();
    };
  }, [onPrompterClose]);

  const handleClose = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (projectName && scriptName && scriptHtml) {
      window.electronAPI.saveScript(projectName, scriptName, scriptHtml);
    }
    setScriptHtml(null);
    setLoaded(false);
    onPrompterClose?.();
    window.electronAPI.sendUpdatedScript('');
    onCloseViewer?.();
  }, [projectName, scriptName, scriptHtml, onPrompterClose, onCloseViewer]);

  useEffect(() => () => handleClose(), []);

  // Ensure the viewer properly cleans up when no script is selected
  const prevSelection = useRef({ projectName: null, scriptName: null });

  useEffect(() => {
    const hadSelection =
      prevSelection.current.projectName && prevSelection.current.scriptName;
    const hasSelection = projectName && scriptName;
    if (hadSelection && !hasSelection) {
      handleClose();
    }
    prevSelection.current = { projectName, scriptName };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, scriptName]);

  const showLogo = !loaded;

  return (
    <div className="script-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2 className="header-title">Script Viewer</h2>
        </div>
      </div>
      {loaded && scriptName && (
        <div className="header-buttons">
          <div className="script-name">
            {scriptName.replace(/\.[^/.]+$/, '')}
          </div>
          <button
            className="close-button"
            onClick={handleClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
      <div className="script-viewer-content">
        {showLogo ? (
          <div className="load-placeholder">
            Welcome to LeaderPrompt. Please load or create a script.
          </div>
        ) : (
          <>
            <div
              ref={contentRef}
              className="script-content"
              contentEditable={true}
              suppressContentEditableWarning={true}
              onBlur={handleBlur}
              onInput={handleInput}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default ScriptViewer;
