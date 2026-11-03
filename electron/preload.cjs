const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('meetoDesktop', {
  onPickSource: (cb) => {
    ipcRenderer.removeAllListeners('meeto:pick-source')
    ipcRenderer.on('meeto:pick-source', (_e, sources) => cb(sources))
  },
  pickSource: (id) => ipcRenderer.send('meeto:picked-source', id),
})
