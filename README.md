# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Electron API

The preload script exposes an `electronAPI` object on `window` for renderer processes. Alongside other helpers, you can listen for live script updates with:

```javascript
window.electronAPI.onScriptUpdated((html) => {
  // handle updated HTML
});
```

This pairs with `sendUpdatedScript(html)` to keep the prompter view in sync.

When running the Electron app in development, the main process now waits for the
Vite dev server at `http://localhost:5173` to respond before creating any
windows. This avoids reload loops while Vite is starting.

## Script Persistence

Edits made in the script editor are automatically written back to the underlying
`.docx` file. The main process converts the edited HTML using
`html-to-docx` and saves it to the selected project/script location via the new
`save-script` IPC handler exposed as
`window.electronAPI.saveScript(projectName, scriptName, html)`.
