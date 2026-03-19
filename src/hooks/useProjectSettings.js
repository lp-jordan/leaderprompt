import { useEffect, useRef, useState } from 'react';

function loadLocalSettings(projectName) {
  const saved = localStorage.getItem(`prompterSettings-${projectName}`);
  return saved ? JSON.parse(saved) : null;
}

function saveLocalSettings(projectName, settings) {
  localStorage.setItem(
    `prompterSettings-${projectName}`,
    JSON.stringify(settings),
  );
}

export default function useProjectSettings(projectName, defaultSettings) {
  const [settings, setSettings] = useState(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!projectName) {
      setSettings(defaultSettings);
      setHydrated(false);
      return;
    }

    let active = true;
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;

    setSettings(defaultSettings);
    setHydrated(false);

    const loadSettings = async () => {
      try {
        let persisted = null;
        if (window.electronAPI?.getProjectSettings) {
          persisted = await window.electronAPI.getProjectSettings(projectName);
        } else {
          persisted = loadLocalSettings(projectName);
        }

        if (!active || loadIdRef.current !== loadId) return;

        setSettings({
          ...defaultSettings,
          ...(persisted || {}),
          autoscroll: false,
        });
        setHydrated(true);
      } catch (err) {
        console.error('Failed to load prompter settings', err);
        if (!active || loadIdRef.current !== loadId) return;
        setSettings(defaultSettings);
        setHydrated(true);
      }
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, [defaultSettings, projectName]);

  useEffect(() => {
    if (!projectName || !hydrated) return;

    if (window.electronAPI?.saveProjectSettings) {
      window.electronAPI.saveProjectSettings(projectName, settings);
    } else {
      saveLocalSettings(projectName, settings);
    }
  }, [hydrated, projectName, settings]);

  return {
    hydrated,
    settings,
    setSettings,
    updateSettings: (updates) =>
      setSettings((current) => ({
        ...current,
        ...(typeof updates === 'function' ? updates(current) : updates),
      })),
    resetSettings: () => setSettings(defaultSettings),
  };
}
