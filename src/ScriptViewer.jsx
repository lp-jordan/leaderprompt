import './ScriptViewer.css';
import { useEffect, useRef, useState } from 'react';

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
}) {
  const [scriptHtml, setScriptHtml] = useState(null);
  const contentRef = useRef(null);
  const saveTimeout = useRef(null);

  useEffect(() => {
    if (projectName && scriptName) {
      window.electronAPI
        .loadScript(projectName, scriptName)
        .then((html) => {
          setScriptHtml(html);
        })
        .catch((err) => {
          console.error('Failed to load script:', err);
        });
    } else {
      setScriptHtml(null);
    }
  }, [projectName, scriptName]);

  useEffect(() => {
    if (
      contentRef.current &&
      scriptHtml !== null &&
      contentRef.current.innerHTML !== scriptHtml
    ) {
      contentRef.current.innerHTML = scriptHtml;
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

  const handleSend = () => {
    if (scriptHtml) {
      window.electronAPI.openPrompter(scriptHtml);
      onPrompterOpen?.(projectName, scriptName);
    }
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      onPrompterClose?.();
    });
    return () => {
      cleanup?.();
    };
  }, [onPrompterClose]);

  const handleClose = () => {
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
  };

  const isLoaded = scriptHtml !== null;

  return (
    <div className="script-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2 className="header-title">Script Viewer</h2>
        </div>
      </div>
      {isLoaded && (
        <div className="script-name-row">
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
        {!isLoaded ? (
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
            <div className="send-button-wrapper">
              <button className="send-button" onClick={handleSend}>
                Let&apos;s Go!
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ScriptViewer;
