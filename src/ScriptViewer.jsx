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
  onCreate,
  onLoad,
  onSend,
}) {
  const [scriptHtml, setScriptHtml] = useState(null);
  const contentRef = useRef(null);
  const saveTimeout = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (projectName && scriptName) {
      window.electronAPI
        .loadScript(projectName, scriptName)
        .then((html) => {
          if (!cancelled) {
            setScriptHtml(html);
          }
        })
        .catch((err) => {
          console.error('Failed to load script:', err);
        });
    } else {
      setScriptHtml(null);
      window.electronAPI.sendUpdatedScript('');
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
    if (scriptHtml) {
      window.electronAPI.openPrompter(scriptHtml);
      onPrompterOpen?.(projectName, scriptName);
    }
  }, [scriptHtml, projectName, scriptName, onPrompterOpen]);

  useEffect(() => {
    onSend?.(scriptHtml ? () => handleSend() : null);
  }, [onSend, handleSend, scriptHtml]);

  useEffect(() => {
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      onPrompterClose?.();
    });
    return () => {
      cleanup?.();
    };
  }, [onPrompterClose]);

  // Clean up when the component unmounts
  useEffect(() => () => handleClose(), [handleClose]);

  const handleClose = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (projectName && scriptName && scriptHtml) {
      window.electronAPI.saveScript(projectName, scriptName, scriptHtml);
    }
    setScriptHtml(null);
    onPrompterClose?.();
    window.electronAPI.sendUpdatedScript('');
    onCloseViewer?.();
  }, [projectName, scriptName, scriptHtml, onPrompterClose, onCloseViewer]);

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
  }, [projectName, scriptName, handleClose]);

  const showLogo = scriptHtml === null;

  return (
    <div className="script-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2 className="header-title">Script Viewer</h2>
        </div>
      </div>
      {scriptName && (
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
            Please{' '}
            <button className="link-button" onClick={onLoad}>
              Load
            </button>{' '}
            or{' '}
            <button className="link-button" onClick={onCreate}>
              Create
            </button>{' '}
            a Script
          </div>
        ) : (
          <>
            <div
              ref={contentRef}
              className="script-content"
              contentEditable
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
