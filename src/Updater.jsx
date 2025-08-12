import { useEffect } from 'react'
import { toast } from 'react-hot-toast'

function Updater() {
  useEffect(() => {
    if (
      !window.electronAPI?.checkForUpdates ||
      !window.electronAPI?.onUpdateChecking ||
      !window.electronAPI?.onUpdateAvailable ||
      !window.electronAPI?.onUpdateNotAvailable ||
      !window.electronAPI?.onUpdateError ||
      !window.electronAPI?.onUpdateProgress ||
      !window.electronAPI?.onUpdateDownloaded ||
      !window.electronAPI?.restartAndInstall
    ) {
      console.error('electronAPI unavailable')
      return
    }
    window.electronAPI.checkForUpdates()

    const cleanChecking = window.electronAPI.onUpdateChecking(() => {
      toast.loading('Checking for updates...', { id: 'update-check' })
    })

    const cleanAvailable = window.electronAPI.onUpdateAvailable((info) => {
      toast.loading(`Downloading update ${info?.version || ''}...`, { id: 'update-download' })
    })

    const cleanNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      toast.dismiss('update-check')
      toast('No updates available.')
    })

    const cleanError = window.electronAPI.onUpdateError((message) => {
      toast.dismiss('update-check')
      toast.dismiss('update-download')
      toast.error(`Update error: ${message}`)
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
          <button onClick={() => { if (!window.electronAPI?.restartAndInstall) { console.error('electronAPI unavailable'); return } window.electronAPI.restartAndInstall(); toast.dismiss(t.id) }}>Restart</button>
        </span>
      ), { duration: Infinity })
    })

    return () => {
      cleanChecking?.()
      cleanAvailable?.()
      cleanNotAvailable?.()
      cleanError?.()
      cleanProgress?.()
      cleanDownloaded?.()
    }
  }, [])

  return null
}

export default Updater
