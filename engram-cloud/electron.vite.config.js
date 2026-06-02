import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({

  // ─── MAIN PROCESS ───────────────────────────────────────────────────────────
  // Runs in Node.js. Has full access to the file system, OS APIs, and Electron.
  // This is where file-tools.js and the API call logic live.
  main: {
    plugins: [
      externalizeDepsPlugin()
      // externalizeDepsPlugin tells Vite: do NOT bundle Node.js built-ins
      // (fs, path, os, etc.) into the output file. Leave them as-is so
      // Node.js resolves them at runtime. Without this, the build breaks
      // because Vite tries to bundle things that only exist in Node.js.
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'main/index.js')
          // Entry point for the main process.
          // resolve() builds an absolute path regardless of OS (Windows uses \,
          // Mac/Linux use /). Always use resolve() instead of string paths.
        }
      }
    }
  },

  // ─── PRELOAD SCRIPT ─────────────────────────────────────────────────────────
  // Runs in a hybrid context - has Node.js access but also touches the browser
  // DOM. Acts as the secure gatekeeper between main and renderer.
  // Only APIs explicitly exposed here are available to the React UI.
  preload: {
    plugins: [
      externalizeDepsPlugin()
      // Same reason as main - preload also runs in Node.js context.
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.js')
        }
      }
    }
  },

  // ─── RENDERER PROCESS ───────────────────────────────────────────────────────
  // Runs in Chromium (browser). This is your React UI.
  // No Node.js access. No fs. No path. Pure browser environment.
  // Communicates to main only through the APIs preload exposes.
  renderer: {
    root: resolve(__dirname, 'renderer'),
    // CRITICAL: tells Vite where the renderer root is.
    // Without this, Vite dev server looks for index.html in the project root
    // and returns 404. With it, Vite serves from renderer/ and finds index.html.
    // Required whenever the renderer lives outside src/renderer/ (the default).

    plugins: [
      react()
    ],
    build: {
      outDir: 'out/renderer',
      // Where compiled renderer output goes after build.

      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html')
          // The HTML shell that React mounts into.
          // React doesn't generate HTML - it needs a host HTML file with
          // a <div id="root"> that it takes over at runtime.
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'renderer/src')
        // Shortcut alias. Instead of writing:
        //   import ChatWindow from '../../components/ChatWindow'
        // you write:
        //   import ChatWindow from '@/components/ChatWindow'
        // Cleaner imports. No relative path hell.
      }
    }
  }

})
