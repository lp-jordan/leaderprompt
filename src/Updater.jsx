import { useEffect } from 'react'
import { toast } from 'react-hot-toast'

function Updater() {
  useEffect(() => {
    window.electronAPI.checkForUpdates()

    const cleanChecking = window.electronAPI.onUpdateChecking(() => {
      toast.loading('Checking for updates...', { id: 'update-check' })
    })

    const cleanAvailable = window.electronAPI.onUpdateAvailable((info) => {
      toast.loading(`Downloading update ${info?.version || ''}...`, { id: 'update-download' })
    })

    const cleanProgress = window.electronAPI.onUpdateProgress((progress) => {
      const percent = Math.round(progress.percent || 0)
      toast.loading(`Downloading update... ${percent}%`, { id: 'update-download' })
    })

    const cleanDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      toast.dismiss('update-check')
      toast.dismiss('update-download')
      toast((t) => (
        <span>
          Update ready.
          <button onClick={() => { window.electronAPI.restartAndInstall(); toast.dismiss(t.id) }}>Restart</button>
        </span>
      ), { duration: Infinity })
    })

    return () => {
      cleanChecking?.()
      cleanAvailable?.()
      cleanProgress?.()
      cleanDownloaded?.()
    }
  }, [])

  return null
}

export default Updater
