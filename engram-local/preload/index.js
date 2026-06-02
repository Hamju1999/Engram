import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  loadConfig:      () => ipcRenderer.invoke('load-config'),
  saveConfig:      (c) => ipcRenderer.invoke('save-config', c),
  classifyDomain:  (m) => ipcRenderer.invoke('classify-domain', m),
  createSession:   (p) => ipcRenderer.invoke('create-session', p),
  writeTurn:       (p) => ipcRenderer.invoke('write-turn', p),
  sendMessage:     (p) => ipcRenderer.invoke('send-message', p),
  listDomains:     () => ipcRenderer.invoke('list-domains'),
  listSessions:    (d) => ipcRenderer.invoke('list-sessions', d),
  readSession:     (p) => ipcRenderer.invoke('read-session', p),
  pickFiles:       () => ipcRenderer.invoke('pick-files'),
  readAttachment:  (p) => ipcRenderer.invoke('read-attachment', p),
  onPipelineStep:  (cb) => {
    ipcRenderer.on('pipeline-step', (_event, step) => cb(step))
    return () => ipcRenderer.removeAllListeners('pipeline-step')
  }
})
