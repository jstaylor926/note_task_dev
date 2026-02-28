import { describe, it, expect } from 'vitest';
import { getRunCommand } from '../runFile';

describe('getRunCommand', () => {
  it('maps python files', () => {
    expect(getRunCommand('/project/main.py', 'py')).toBe('python "/project/main.py"');
  });

  it('maps javascript files', () => {
    expect(getRunCommand('/project/app.js', 'js')).toBe('node "/project/app.js"');
  });

  it('maps jsx files', () => {
    expect(getRunCommand('/project/app.jsx', 'jsx')).toBe('node "/project/app.jsx"');
  });

  it('maps typescript files', () => {
    expect(getRunCommand('/project/app.ts', 'ts')).toBe('npx ts-node "/project/app.ts"');
  });

  it('maps tsx files', () => {
    expect(getRunCommand('/project/app.tsx', 'tsx')).toBe('npx ts-node "/project/app.tsx"');
  });

  it('maps rust files to cargo run', () => {
    expect(getRunCommand('/project/src/main.rs', 'rs')).toBe('cargo run');
  });

  it('maps shell scripts', () => {
    expect(getRunCommand('/project/build.sh', 'sh')).toBe('bash "/project/build.sh"');
  });

  it('maps bash scripts', () => {
    expect(getRunCommand('/project/build.bash', 'bash')).toBe('bash "/project/build.bash"');
  });

  it('returns null for unknown language', () => {
    expect(getRunCommand('/project/data.csv', 'csv')).toBeNull();
  });

  it('detects language from file extension when not provided', () => {
    expect(getRunCommand('/project/main.py')).toBe('python "/project/main.py"');
  });

  it('returns null for files without extension', () => {
    expect(getRunCommand('/project/Makefile')).toBeNull();
  });

  it('quotes paths with spaces', () => {
    expect(getRunCommand('/my project/main.py', 'py')).toBe('python "/my project/main.py"');
  });
});
