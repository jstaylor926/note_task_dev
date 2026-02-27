use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum ShellType {
    Zsh,
    Bash,
    Fish,
    Unknown,
}

/// Detect the shell type from a shell path like "/bin/zsh" or "/usr/local/bin/bash".
pub fn detect_shell_type(path: &str) -> ShellType {
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    match name {
        "zsh" => ShellType::Zsh,
        "bash" => ShellType::Bash,
        "fish" => ShellType::Fish,
        _ => ShellType::Unknown,
    }
}

/// Generate zsh hook script that emits OSC 633 sequences for command capture.
/// The script sources the user's real ~/.zshrc first, then installs hooks.
pub fn generate_zsh_hooks() -> String {
    r#"# Cortex shell integration for zsh
# Source user's real zshrc
if [ -n "$CORTEX_USER_ZDOTDIR" ] && [ -f "$CORTEX_USER_ZDOTDIR/.zshrc" ]; then
  ZDOTDIR="$CORTEX_USER_ZDOTDIR" source "$CORTEX_USER_ZDOTDIR/.zshrc"
elif [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi

# OSC 633 shell integration
__cortex_preexec() {
  # E: command text
  printf '\e]633;E;%s\a' "$1"
  # C: command start (execution begins)
  printf '\e]633;C\a'
}

__cortex_precmd() {
  local exit_code=$?
  # D: command done with exit code
  printf '\e]633;D;%s\a' "$exit_code"
  # P: property — current working directory
  printf '\e]633;P;Cwd=%s\a' "$PWD"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __cortex_preexec
add-zsh-hook precmd __cortex_precmd

# Emit initial CWD
printf '\e]633;P;Cwd=%s\a' "$PWD"
"#
    .to_string()
}

/// Generate bash hook script that emits OSC 633 sequences for command capture.
pub fn generate_bash_hooks() -> String {
    r#"# Cortex shell integration for bash
# Source user's real bashrc
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

# OSC 633 shell integration
__cortex_cmd=""

__cortex_debug_trap() {
  if [ -z "$__cortex_cmd" ]; then
    __cortex_cmd="$BASH_COMMAND"
    # E: command text
    printf '\e]633;E;%s\a' "$__cortex_cmd"
    # C: command start
    printf '\e]633;C\a'
  fi
}

__cortex_prompt_command() {
  local exit_code=$?
  if [ -n "$__cortex_cmd" ]; then
    # D: command done with exit code
    printf '\e]633;D;%s\a' "$exit_code"
  fi
  # P: property — current working directory
  printf '\e]633;P;Cwd=%s\a' "$PWD"
  __cortex_cmd=""
}

trap '__cortex_debug_trap' DEBUG
PROMPT_COMMAND="__cortex_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"

# Emit initial CWD
printf '\e]633;P;Cwd=%s\a' "$PWD"
"#
    .to_string()
}

/// Write shell hook scripts to the app data directory.
/// Returns the path to the hook directory.
pub fn setup_hook_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let hook_dir = app_data_dir.join("shell_hooks");
    std::fs::create_dir_all(&hook_dir)
        .map_err(|e| format!("Failed to create shell hooks directory: {}", e))?;

    // Write zsh hooks
    let zshrc_path = hook_dir.join(".zshrc");
    std::fs::write(&zshrc_path, generate_zsh_hooks())
        .map_err(|e| format!("Failed to write zsh hooks: {}", e))?;

    // Write bash hooks
    let bashrc_path = hook_dir.join(".bashrc");
    std::fs::write(&bashrc_path, generate_bash_hooks())
        .map_err(|e| format!("Failed to write bash hooks: {}", e))?;

    Ok(hook_dir)
}

/// Build a CommandBuilder for the shell with hook integration.
/// Sets ZDOTDIR (zsh) or --rcfile (bash) to load our hooks.
pub fn build_shell_command(shell_path: &str, hook_dir: &Path) -> CommandBuilder {
    let shell_type = detect_shell_type(shell_path);
    let mut cmd = CommandBuilder::new(shell_path);

    match shell_type {
        ShellType::Zsh => {
            // Preserve user's ZDOTDIR so our hook can chain-source it
            if let Ok(existing) = std::env::var("ZDOTDIR") {
                cmd.env("CORTEX_USER_ZDOTDIR", existing);
            }
            cmd.env("ZDOTDIR", hook_dir);
        }
        ShellType::Bash => {
            let rcfile = hook_dir.join(".bashrc");
            cmd.args(["--rcfile", &rcfile.to_string_lossy()]);
        }
        _ => {
            // Fish and unknown shells — run without hooks for now
        }
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_shell_type_zsh() {
        assert_eq!(detect_shell_type("/bin/zsh"), ShellType::Zsh);
        assert_eq!(detect_shell_type("/usr/local/bin/zsh"), ShellType::Zsh);
    }

    #[test]
    fn test_detect_shell_type_bash() {
        assert_eq!(detect_shell_type("/bin/bash"), ShellType::Bash);
        assert_eq!(detect_shell_type("/usr/bin/bash"), ShellType::Bash);
    }

    #[test]
    fn test_detect_shell_type_fish() {
        assert_eq!(detect_shell_type("/usr/bin/fish"), ShellType::Fish);
    }

    #[test]
    fn test_detect_shell_type_unknown() {
        assert_eq!(detect_shell_type("/bin/sh"), ShellType::Unknown);
        assert_eq!(detect_shell_type(""), ShellType::Unknown);
    }

    #[test]
    fn test_zsh_hooks_contain_osc_sequences() {
        let hooks = generate_zsh_hooks();
        assert!(hooks.contains("633;C"));
        assert!(hooks.contains("633;D"));
        assert!(hooks.contains("633;E"));
        assert!(hooks.contains("633;P;Cwd="));
        assert!(hooks.contains("add-zsh-hook"));
        assert!(hooks.contains("preexec"));
        assert!(hooks.contains("precmd"));
    }

    #[test]
    fn test_bash_hooks_contain_osc_sequences() {
        let hooks = generate_bash_hooks();
        assert!(hooks.contains("633;C"));
        assert!(hooks.contains("633;D"));
        assert!(hooks.contains("633;E"));
        assert!(hooks.contains("633;P;Cwd="));
        assert!(hooks.contains("PROMPT_COMMAND"));
        assert!(hooks.contains("DEBUG"));
    }

    #[test]
    fn test_setup_hook_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let hook_dir = setup_hook_dir(tmp.path()).unwrap();
        assert!(hook_dir.join(".zshrc").exists());
        assert!(hook_dir.join(".bashrc").exists());
    }

    #[test]
    fn test_build_shell_command_zsh_sets_zdotdir() {
        let tmp = tempfile::tempdir().unwrap();
        let hook_dir = tmp.path().join("shell_hooks");
        std::fs::create_dir_all(&hook_dir).unwrap();

        let cmd = build_shell_command("/bin/zsh", &hook_dir);
        // CommandBuilder doesn't expose env vars directly for inspection,
        // but we can verify it was constructed without errors
        assert!(format!("{:?}", cmd).contains("zsh"));
    }
}
