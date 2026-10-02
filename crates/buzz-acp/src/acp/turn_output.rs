use std::collections::HashSet;

/// Observable user-facing output produced during one ACP prompt.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct TurnOutput {
    /// Text emitted after the most recent tool call. ACP has no portable
    /// assistant-message boundary, so the latest tool call is the safe cutoff.
    pub final_text: String,
    /// The turn attempted at least one explicit `buzz messages send`.
    pub publish_attempted: bool,
    /// At least one explicit send received a signed relay acknowledgement.
    pub published_via_cli: bool,
}

#[derive(Debug, Default)]
pub(super) struct TurnOutputCapture {
    output: TurnOutput,
    publish_tool_calls: HashSet<String>,
}

impl TurnOutputCapture {
    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn push_text(&mut self, text: &str) {
        self.output.final_text.push_str(text);
    }

    pub(super) fn tool_started(&mut self, update: &serde_json::Value) {
        self.output.final_text.clear();
        self.track_publish_tool(update);
    }

    pub(super) fn tool_updated(&mut self, update: &serde_json::Value) {
        let Some(tool_call_id) = update.get("toolCallId").and_then(|value| value.as_str()) else {
            return;
        };

        // OpenCode attaches the concrete shell command to the terminal update.
        self.track_publish_tool(update);
        if !self.publish_tool_calls.contains(tool_call_id) {
            return;
        }

        match update.get("status").and_then(|value| value.as_str()) {
            Some("completed") => {
                let reported_error = update
                    .pointer("/rawOutput/isError")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let nonzero_exit = update
                    .pointer("/rawOutput/metadata/exit")
                    .or_else(|| update.pointer("/rawOutput/exit"))
                    .and_then(|value| value.as_i64())
                    .is_some_and(|exit| exit != 0);
                let relay_accepted = update
                    .get("content")
                    .is_some_and(value_contains_buzz_acceptance)
                    || update
                        .get("rawOutput")
                        .is_some_and(value_contains_buzz_acceptance);
                if !reported_error && !nonzero_exit && relay_accepted {
                    self.output.published_via_cli = true;
                }
                self.publish_tool_calls.remove(tool_call_id);
            }
            Some("failed") => {
                self.publish_tool_calls.remove(tool_call_id);
            }
            _ => {}
        }
    }

    fn track_publish_tool(&mut self, update: &serde_json::Value) {
        let Some(tool_call_id) = update.get("toolCallId").and_then(|value| value.as_str()) else {
            return;
        };
        let title = update.get("title").and_then(|value| value.as_str());
        let raw_command = update
            .get("rawInput")
            .and_then(|value| value.get("command"))
            .and_then(|value| value.as_str())
            .or_else(|| update.get("rawInput").and_then(|value| value.as_str()));

        if title.is_some_and(is_buzz_message_send_command)
            || raw_command.is_some_and(is_buzz_message_send_command)
        {
            self.output.publish_attempted = true;
            self.publish_tool_calls.insert(tool_call_id.to_string());
        }
    }

    pub(super) fn take(&mut self) -> TurnOutput {
        self.publish_tool_calls.clear();
        std::mem::take(&mut self.output)
    }
}

fn value_contains_buzz_acceptance(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(object) => {
            object.get("accepted").and_then(|value| value.as_bool()) == Some(true)
                || object.values().any(value_contains_buzz_acceptance)
        }
        serde_json::Value::Array(values) => values.iter().any(value_contains_buzz_acceptance),
        serde_json::Value::String(text) => text.lines().any(|line| {
            serde_json::from_str::<serde_json::Value>(line.trim())
                .is_ok_and(|parsed| value_contains_buzz_acceptance(&parsed))
        }),
        _ => false,
    }
}

fn is_buzz_message_send_command(command: &str) -> bool {
    let command = command.trim_start();
    command.starts_with("buzz messages send ")
        || command == "buzz messages send"
        || ["|", "&&", ";", "||"]
            .iter()
            .any(|separator| command.contains(&format!("{separator} buzz messages send ")))
}
