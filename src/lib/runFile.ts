const runCommandMap: Record<string, (path: string) => string> = {
  py: (path) => `python "${path}"`,
  python: (path) => `python "${path}"`,
  js: (path) => `node "${path}"`,
  jsx: (path) => `node "${path}"`,
  ts: (path) => `npx ts-node "${path}"`,
  tsx: (path) => `npx ts-node "${path}"`,
  rs: () => 'cargo run',
  rust: () => 'cargo run',
  sh: (path) => `bash "${path}"`,
  bash: (path) => `bash "${path}"`,
  zsh: (path) => `bash "${path}"`,
};

export function getRunCommand(
  filePath: string,
  language?: string,
): string | null {
  const lang = language ?? getExtension(filePath);
  if (!lang) return null;
  const factory = runCommandMap[lang.toLowerCase()];
  return factory ? factory(filePath) : null;
}

function getExtension(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return undefined;
  return filePath.slice(dot + 1).toLowerCase();
}
