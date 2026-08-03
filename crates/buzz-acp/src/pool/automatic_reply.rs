use super::*;

/// Destination and delivery obligation for a harness-owned channel reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AutomaticReplyTarget {
    pub(super) channel_id: Uuid,
    pub(super) root_event_id: Option<String>,
    pub(super) parent_event_id: Option<String>,
    pub(super) requires_reply: bool,
}

/// Resolve the same reply topology that `queue::format_prompt` gives the agent.
pub(super) fn automatic_reply_target(
    batch: &FlushBatch,
    channel_info: Option<&PromptChannelInfo>,
    profile_lookup: Option<&PromptProfileLookup>,
) -> Option<AutomaticReplyTarget> {
    let last_event = batch.events.last()?;
    let sender = last_event.event.pubkey.to_hex();
    let triggering_event_id = last_event.event.id.to_hex();
    let thread_tags = crate::queue::parse_thread_tags(&last_event.event);
    let is_dm = channel_info.is_some_and(|info| info.channel_type == "dm");
    let human_anchor = (!is_dm)
        .then(|| {
            crate::queue::resolve_reply_anchor(
                &sender,
                &thread_tags,
                &triggering_event_id,
                profile_lookup,
            )
        })
        .flatten();
    let sender_is_agent = profile_lookup
        .and_then(|profiles| profiles.get(&sender))
        .is_some_and(|profile| profile.is_agent);
    let requires_reply = if is_dm {
        !sender_is_agent
    } else {
        human_anchor.is_some()
    };

    let (root_event_id, parent_event_id) = if is_dm {
        match thread_tags.root_event_id {
            Some(root) => (Some(root), Some(triggering_event_id)),
            None => (None, None),
        }
    } else if let Some(anchor) = human_anchor {
        (Some(anchor.clone()), Some(anchor))
    } else {
        (
            Some(
                thread_tags
                    .root_event_id
                    .unwrap_or_else(|| triggering_event_id.clone()),
            ),
            Some(triggering_event_id),
        )
    };

    Some(AutomaticReplyTarget {
        channel_id: batch.channel_id,
        root_event_id,
        parent_event_id,
        requires_reply,
    })
}

pub(super) fn completed_turn_reply(
    source: &PromptSource,
    stop_reason: &StopReason,
    output: &TurnOutput,
    target: Option<&AutomaticReplyTarget>,
) -> Result<Option<String>, AcpError> {
    if !matches!(source, PromptSource::Channel(_))
        || matches!(stop_reason, StopReason::Cancelled)
        || output.published_via_cli
    {
        return Ok(None);
    }
    let content = output.final_text.trim();
    if !content.is_empty() {
        if target.is_none() {
            return Err(AcpError::Delivery(
                "completed channel turn has no reply target".into(),
            ));
        }
        return Ok(Some(content.to_string()));
    }
    if output.publish_attempted {
        return Err(AcpError::Delivery(
            "explicit Buzz publication failed and no final response remained".into(),
        ));
    }
    if target.is_some_and(|target| target.requires_reply) {
        return Err(AcpError::Delivery(
            "human-facing turn completed without a response".into(),
        ));
    }
    Ok(None)
}

async fn publish_automatic_reply(
    rest: &crate::relay::RestClient,
    target: &AutomaticReplyTarget,
    content: &str,
) -> Result<(), AcpError> {
    let thread_ref = match (&target.root_event_id, &target.parent_event_id) {
        (None, None) => None,
        (Some(root), Some(parent)) => {
            let root_event_id = nostr::EventId::from_hex(root)
                .map_err(|error| AcpError::Delivery(format!("invalid thread root: {error}")))?;
            let parent_event_id = nostr::EventId::from_hex(parent)
                .map_err(|error| AcpError::Delivery(format!("invalid thread parent: {error}")))?;
            Some(buzz_sdk::ThreadRef {
                root_event_id,
                parent_event_id,
            })
        }
        _ => {
            return Err(AcpError::Delivery(
                "incomplete automatic reply thread target".into(),
            ));
        }
    };

    let builder = buzz_sdk::build_message(
        target.channel_id,
        content,
        thread_ref.as_ref(),
        &[],
        false,
        &[],
    )
    .map_err(|error| AcpError::Delivery(format!("message build failed: {error}")))?;
    let event = builder
        .sign_with_keys(&rest.keys)
        .map_err(|error| AcpError::Delivery(format!("message signing failed: {error}")))?;

    match tokio::time::timeout(Duration::from_secs(5), rest.submit_event(&event)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => Err(AcpError::Delivery(format!(
            "relay rejected response: {error}"
        ))),
        Err(_) => Err(AcpError::Delivery(
            "relay submission timed out after 5s".into(),
        )),
    }
}

/// Publish a normal final answer, or fail the turn when a required reply
/// disappeared. Agent-to-agent turns may intentionally end silently.
pub(super) async fn ensure_completed_turn_delivered(
    ctx: &PromptContext,
    source: &PromptSource,
    stop_reason: &StopReason,
    output: TurnOutput,
    target: Option<&AutomaticReplyTarget>,
) -> Result<(), AcpError> {
    if output.published_via_cli {
        tracing::debug!(target: "pool::delivery", "explicit Buzz publication observed; fallback suppressed");
    }
    if let Some(content) = completed_turn_reply(source, stop_reason, &output, target)? {
        let target = target.ok_or_else(|| {
            AcpError::Delivery("completed channel turn has no reply target".into())
        })?;
        publish_automatic_reply(&ctx.rest_client, target, &content).await?;
        tracing::info!(
            target: "pool::delivery",
            channel = %target.channel_id,
            bytes = content.len(),
            "published captured ACP final response"
        );
        return Ok(());
    }

    Ok(())
}
