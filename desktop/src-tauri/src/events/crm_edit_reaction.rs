//! Bounded CRM draft-edit controls transported as signed kind-7 reactions.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use nostr::{Event, EventBuilder, EventId, Kind};

const PREFIX: &str = "crm-action-edit:v1:";
const MAX_BODY_CHARS: usize = 12_000;

fn validate(content: &str) -> Result<&str, String> {
    super::check_content(content)?;
    let (nonce, encoded) = content
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.split_once(':'))
        .ok_or("invalid CRM edit envelope")?;
    if nonce.is_empty()
        || nonce.len() > 48
        || !nonce
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("invalid CRM edit nonce".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "invalid CRM edit encoding")?;
    let body = std::str::from_utf8(&bytes).map_err(|_| "CRM edit must be UTF-8")?;
    if body.trim().chars().count() < 5 || body.chars().count() > MAX_BODY_CHARS {
        return Err("CRM edit must contain 5 to 12000 characters".into());
    }
    Ok(nonce)
}

pub fn build_reaction(target_event_id: EventId, emoji: &str) -> Result<EventBuilder, String> {
    if emoji.starts_with(PREFIX) {
        let nonce = validate(emoji)?;
        let tags = vec![
            super::tag(vec!["e", &target_event_id.to_hex()])?,
            super::tag(vec!["crm-edit", emoji])?,
        ];
        return Ok(EventBuilder::new(Kind::Custom(7), format!("crm-edit:{nonce}")).tags(tags));
    }
    if emoji.chars().count() > super::MAX_EMOJI_CHARS {
        return Err(format!(
            "emoji exceeds maximum length of {} characters",
            super::MAX_EMOJI_CHARS
        ));
    }
    let tags = vec![super::tag(vec!["e", &target_event_id.to_hex()])?];
    Ok(EventBuilder::new(Kind::Custom(7), emoji).tags(tags))
}

pub(crate) fn matches(event: &Event, payload: &str) -> bool {
    event.content.trim() == payload
        || payload.starts_with(PREFIX)
            && event.tags.iter().any(|tag| {
                let parts = tag.as_slice();
                parts.len() == 2 && parts[0] == "crm-edit" && parts[1] == payload
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn accepts_long_utf8_body_and_preserves_payload() {
        let target = EventId::all_zeros();
        let body = "TEST ÉDITION VALIDÉE Bonjour Arnaud. ".repeat(20);
        let payload = format!("{PREFIX}test-nonce:{}", URL_SAFE_NO_PAD.encode(&body));
        let event = super::super::build_reaction(target, &payload)
            .unwrap()
            .sign_with_keys(&Keys::generate())
            .unwrap();
        assert_eq!(event.kind, Kind::Custom(7));
        assert_eq!(event.content, "crm-edit:test-nonce");
        assert!(matches(&event, &payload));
        assert_eq!(
            event.tags.iter().next().unwrap().as_slice(),
            ["e", &target.to_hex()]
        );
    }

    #[test]
    fn keeps_limits_and_rejects_malformed_envelopes() {
        let target = EventId::all_zeros();
        for payload in [
            "x".repeat(65),
            format!("{PREFIX}:SGVsbG8"),
            format!("{PREFIX}nonce:%%%"),
            format!("{PREFIX}nonce:{}", URL_SAFE_NO_PAD.encode([0xff])),
            format!("{PREFIX}{}:SGVsbG8", "n".repeat(129)),
            format!(
                "{PREFIX}nonce:{}",
                URL_SAFE_NO_PAD.encode("x".repeat(12_001))
            ),
            format!("{PREFIX}nonce:{}", URL_SAFE_NO_PAD.encode("   ")),
        ] {
            assert!(super::super::build_reaction(target, &payload).is_err());
        }
        assert!(super::super::build_reaction(target, "✅").is_ok());
        let payload = format!(
            "{PREFIX}nonce:{}",
            URL_SAFE_NO_PAD.encode("é".repeat(12_000))
        );
        assert!(super::super::build_reaction(target, &payload).is_ok());
    }
}
