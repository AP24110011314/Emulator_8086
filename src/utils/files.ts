// File save/open for assembly programs.
//
// Runs natively inside Tauri (Finder save/open dialogs via
// @tauri-apps/plugin-dialog, disk I/O via @tauri-apps/plugin-fs) and falls
// back to Blob download / <input type="file"> when running as a plain web
// page (`npm run dev` in a browser tab), where the Tauri APIs don't exist.
//
// The Tauri plugins are dynamically imported only when a Tauri webview is
// detected, so the browser bundle never touches them.

const ASM_FILTER = { name: 'Assembly source', extensions: ['asm'] };

/** True when running inside a Tauri webview (native dialogs available). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Save `contents` to disk. In Tauri this shows the native Finder save sheet;
 * in a browser it triggers a Blob download. Returns the saved file path (or
 * download filename in a browser), or null when the user cancels (only
 * possible in the Tauri dialog). Throws on I/O errors.
 */
export async function saveAsmFile(
  contents: string,
  suggestedName = 'program.asm',
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: suggestedName,
      filters: [ASM_FILTER],
    });
    if (path === null) return null;
    await writeTextFile(path, contents);
    return path;
  }

  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return suggestedName;
}

export interface OpenedAsmFile {
  name: string;
  contents: string;
}

/**
 * Open a `.asm` file from disk. In Tauri this shows the native Finder open
 * panel; in a browser it uses a hidden file input. Returns null when the
 * user cancels. Throws on I/O errors.
 */
export async function openAsmFile(): Promise<OpenedAsmFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const selected = await open({ multiple: false, filters: [ASM_FILTER] });
    if (selected === null) return null;
    const path = selected as string;
    const contents = await readTextFile(path);
    const name = path.split(/[/\\]/).pop() || 'program.asm';
    return { name, contents };
  }

  return new Promise<OpenedAsmFile | null>((resolve) => {
    let settled = false;
    const cleanup = () => window.removeEventListener('focus', onFocus);
    const onFocus = () => {
      // The picker window closing refocuses the page both on selection and
      // on cancel; only treat it as a cancel if no file was chosen. The
      // change event (if any) dispatches right after focus, hence the delay.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    window.addEventListener('focus', onFocus);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.asm,.txt';
    input.onchange = () => {
      settled = true;
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: file.name, contents: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
