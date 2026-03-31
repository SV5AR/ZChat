self.addEventListener('message', async (ev) => {
  const { id, cmd, payload } = ev.data
  if (cmd === 'deriveSeed') {
    try {
      importScripts('/node_modules/argon2-wasm/dist/argon2-bundler.js')
    } catch (e) {}
    // This worker will post back an error — actual derivation performed in main thread for simplicity here
    self.postMessage({ id, ok: false, error: 'not implemented in worker' })
  }
})
