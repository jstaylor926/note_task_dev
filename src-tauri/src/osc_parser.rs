/// OSC 633 parser — streaming state machine that extracts shell integration
/// sequences from PTY output and passes through all other data.

#[derive(Debug, Clone, PartialEq)]
pub enum OscEvent {
    /// 633;C — command execution started
    CommandStart,
    /// 633;D;{exit_code} — command finished
    CommandEnd { exit_code: Option<i32> },
    /// 633;E;{text} — command text captured
    CommandText { text: String },
    /// 633;P;Cwd={path} — working directory changed
    CwdChange { path: String },
}

pub struct ParseResult {
    /// Clean bytes to forward to xterm (with 633 sequences stripped)
    pub output: Vec<u8>,
    /// Extracted events
    pub events: Vec<OscEvent>,
}

#[derive(Debug, Clone, PartialEq)]
enum State {
    Normal,
    /// Saw ESC (0x1b)
    Escape,
    /// Inside OSC: saw ESC ]
    OscBody,
}

const MAX_OSC_BUFFER_SIZE: usize = 64 * 1024; // 64KB limit to prevent memory exhaustion

/// Streaming OSC 633 parser with partial buffer for cross-chunk sequences.
pub struct OscParser {
    state: State,
    osc_buf: Vec<u8>,
}

impl OscParser {
    pub fn new() -> Self {
        Self {
            state: State::Normal,
            osc_buf: Vec::new(),
        }
    }

    pub fn parse(&mut self, input: &[u8]) -> ParseResult {
        let mut output = Vec::with_capacity(input.len());
        let mut events = Vec::new();

        for &byte in input {
            match self.state {
                State::Normal => {
                    if byte == 0x1b {
                        self.state = State::Escape;
                    } else if byte == 0x07 {
                        // BEL in normal state — just pass through
                        output.push(byte);
                    } else {
                        output.push(byte);
                    }
                }
                State::Escape => {
                    if byte == b']' {
                        // Start of OSC sequence
                        self.state = State::OscBody;
                        self.osc_buf.clear();
                    } else {
                        // Not an OSC — emit ESC + this byte as pass-through
                        output.push(0x1b);
                        output.push(byte);
                        self.state = State::Normal;
                    }
                }
                State::OscBody => {
                    if byte == 0x07 {
                        // BEL terminates OSC
                        self.handle_osc(&mut output, &mut events);
                        self.state = State::Normal;
                    } else if byte == 0x1b {
                        // Could be ST terminator (ESC \)
                        // Check if next byte is backslash — for now, store ESC in buffer
                        // and handle in a special way
                        if self.osc_buf.len() >= MAX_OSC_BUFFER_SIZE {
                            self.osc_buf.clear();
                            self.state = State::Normal;
                        } else {
                            self.osc_buf.push(byte);
                        }
                    } else if byte == b'\\' && self.osc_buf.last() == Some(&0x1b) {
                        // ST terminator (ESC \) — remove the ESC from buffer
                        self.osc_buf.pop();
                        self.handle_osc(&mut output, &mut events);
                        self.state = State::Normal;
                    } else {
                        if self.osc_buf.len() >= MAX_OSC_BUFFER_SIZE {
                            // Buffer limit exceeded — discard and reset
                            self.osc_buf.clear();
                            self.state = State::Normal;
                        } else {
                            self.osc_buf.push(byte);
                        }
                    }
                }
            }
        }

        ParseResult { output, events }
    }

    fn handle_osc(&mut self, output: &mut Vec<u8>, events: &mut Vec<OscEvent>) {
        let body = String::from_utf8_lossy(&self.osc_buf).to_string();

        if body.starts_with("633;") {
            // This is our shell integration sequence — parse and don't forward
            let parts: Vec<&str> = body.splitn(3, ';').collect();
            if parts.len() >= 2 {
                match parts[1] {
                    "C" => events.push(OscEvent::CommandStart),
                    "D" => {
                        let exit_code = parts.get(2).and_then(|s| s.parse::<i32>().ok());
                        events.push(OscEvent::CommandEnd { exit_code });
                    }
                    "E" => {
                        let text = parts.get(2).unwrap_or(&"").to_string();
                        events.push(OscEvent::CommandText { text });
                    }
                    "P" => {
                        let prop = parts.get(2).unwrap_or(&"");
                        if let Some(path) = prop.strip_prefix("Cwd=") {
                            events.push(OscEvent::CwdChange {
                                path: path.to_string(),
                            });
                        }
                    }
                    _ => {} // Unknown 633 subtype — silently drop
                }
            }
        } else {
            // Non-633 OSC — pass through (e.g., title changes, hyperlinks)
            output.push(0x1b);
            output.push(b']');
            output.extend_from_slice(&self.osc_buf);
            output.push(0x07);
        }

        self.osc_buf.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_regular_output_passthrough() {
        let mut parser = OscParser::new();
        let input = b"Hello, world!\r\n";
        let result = parser.parse(input);
        assert_eq!(result.output, input.to_vec());
        assert!(result.events.is_empty());
    }

    #[test]
    fn test_empty_input() {
        let mut parser = OscParser::new();
        let result = parser.parse(b"");
        assert!(result.output.is_empty());
        assert!(result.events.is_empty());
    }

    #[test]
    fn test_command_start() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;C\x07";
        let result = parser.parse(input);
        assert!(result.output.is_empty());
        assert_eq!(result.events, vec![OscEvent::CommandStart]);
    }

    #[test]
    fn test_command_end_with_exit_code() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;D;0\x07";
        let result = parser.parse(input);
        assert!(result.output.is_empty());
        assert_eq!(
            result.events,
            vec![OscEvent::CommandEnd {
                exit_code: Some(0)
            }]
        );
    }

    #[test]
    fn test_command_end_error_exit_code() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;D;127\x07";
        let result = parser.parse(input);
        assert_eq!(
            result.events,
            vec![OscEvent::CommandEnd {
                exit_code: Some(127)
            }]
        );
    }

    #[test]
    fn test_command_text() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;E;ls -la\x07";
        let result = parser.parse(input);
        assert!(result.output.is_empty());
        assert_eq!(
            result.events,
            vec![OscEvent::CommandText {
                text: "ls -la".to_string()
            }]
        );
    }

    #[test]
    fn test_cwd_change() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;P;Cwd=/home/user/project\x07";
        let result = parser.parse(input);
        assert!(result.output.is_empty());
        assert_eq!(
            result.events,
            vec![OscEvent::CwdChange {
                path: "/home/user/project".to_string()
            }]
        );
    }

    #[test]
    fn test_non_633_osc_passthrough() {
        let mut parser = OscParser::new();
        // OSC 0 — window title
        let input = b"\x1b]0;My Terminal\x07";
        let result = parser.parse(input);
        // Should be passed through
        assert_eq!(result.output, input.to_vec());
        assert!(result.events.is_empty());
    }

    #[test]
    fn test_mixed_output_and_osc() {
        let mut parser = OscParser::new();
        let input = b"before\x1b]633;C\x07after";
        let result = parser.parse(input);
        assert_eq!(result.output, b"beforeafter".to_vec());
        assert_eq!(result.events, vec![OscEvent::CommandStart]);
    }

    #[test]
    fn test_st_terminator() {
        let mut parser = OscParser::new();
        // OSC terminated by ESC \ instead of BEL
        let input = b"\x1b]633;D;0\x1b\\";
        let result = parser.parse(input);
        assert_eq!(
            result.events,
            vec![OscEvent::CommandEnd {
                exit_code: Some(0)
            }]
        );
    }

    #[test]
    fn test_split_across_chunks() {
        let mut parser = OscParser::new();

        // First chunk: ESC ] 633;D
        let result1 = parser.parse(b"\x1b]633;D");
        assert!(result1.output.is_empty());
        assert!(result1.events.is_empty());

        // Second chunk: ;0 BEL
        let result2 = parser.parse(b";0\x07");
        assert!(result2.output.is_empty());
        assert_eq!(
            result2.events,
            vec![OscEvent::CommandEnd {
                exit_code: Some(0)
            }]
        );
    }

    #[test]
    fn test_split_at_esc() {
        let mut parser = OscParser::new();

        // First chunk ends with ESC
        let result1 = parser.parse(b"hello\x1b");
        assert_eq!(result1.output, b"hello".to_vec());
        assert!(result1.events.is_empty());

        // Second chunk starts with ]
        let result2 = parser.parse(b"]633;C\x07world");
        assert_eq!(result2.output, b"world".to_vec());
        assert_eq!(result2.events, vec![OscEvent::CommandStart]);
    }

    #[test]
    fn test_non_osc_escape_sequence() {
        let mut parser = OscParser::new();
        // CSI sequence (ESC [) — should pass through
        let input = b"\x1b[31mred\x1b[0m";
        let result = parser.parse(input);
        assert_eq!(result.output, input.to_vec());
        assert!(result.events.is_empty());
    }

    #[test]
    fn test_multiple_events_in_one_chunk() {
        let mut parser = OscParser::new();
        let input = b"\x1b]633;E;echo hi\x07\x1b]633;C\x07output\x1b]633;D;0\x07";
        let result = parser.parse(input);
        assert_eq!(result.output, b"output".to_vec());
        assert_eq!(
            result.events,
            vec![
                OscEvent::CommandText {
                    text: "echo hi".to_string()
                },
                OscEvent::CommandStart,
                OscEvent::CommandEnd {
                    exit_code: Some(0)
                },
            ]
        );
    }

    #[test]
    fn test_buffer_limit() {
        let mut parser = OscParser::new();
        // Start OSC
        let _ = parser.parse(b"\x1b]");
        
        // Feed 65536 bytes (limit) + 1 byte to trigger the limit
        let large_payload = vec![b'A'; 65536 + 1];
        let _result = parser.parse(&large_payload);
        
        // The parser should reset state to Normal when limit is exceeded
        // and we fed 65537 bytes. The 65537th byte should trigger the reset.
        assert_eq!(parser.state, State::Normal);
        assert!(parser.osc_buf.is_empty());
    }
}
