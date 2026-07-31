//! Opt-in, loopback-only automation surface for local desktop administration.
//!
//! This deliberately reuses the same Tauri commands as the UI instead of
//! touching the managed-agent JSON stores. As a result, API-created personas,
//! agents, and teams retain the normal validation, Nostr owner signatures, and
//! keyring handling. It only starts when both required environment variables
//! are set, listens on `127.0.0.1`, requires a bearer token on every route, and
//! removes that token from the process environment before any agent is spawned.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use crate::{
    app_state::AppState,
    commands,
    managed_agents::{
        AgentDefinition, BackendKind, CreateManagedAgentRequest, CreatePersonaRequest,
        CreateTeamRequest, ManagedAgentSummary, TeamRecord, UpdateManagedAgentRequest,
        UpdatePersonaRequest, UpdateTeamRequest,
    },
};

const TOKEN_ENV: &str = "BUZZ_LOCAL_AUTOMATION_TOKEN";
const PORT_ENV: &str = "BUZZ_LOCAL_AUTOMATION_PORT";
const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Clone)]
struct AutomationState {
    app: AppHandle,
    bearer_token: Arc<str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AutomationConfig {
    bearer_token: String,
    port: u16,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct AutomationAgentResponse {
    agent: ManagedAgentSummary,
    profile_sync_error: Option<String>,
    spawn_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePersonaWithAgentRequest {
    persona: CreatePersonaRequest,
    #[serde(default)]
    start_after_create: bool,
    #[serde(default)]
    start_on_app_launch: bool,
    #[serde(default)]
    agent_args: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentArgsRequest {
    agent_args: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentStartOnAppLaunchRequest {
    start_on_app_launch: bool,
}

#[derive(Debug, Serialize)]
struct CreatePersonaWithAgentResponse {
    persona: AgentDefinition,
    agent: AutomationAgentResponse,
}

#[derive(Debug)]
enum AutomationError {
    Unauthorized,
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AutomationError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Internal(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

fn parse_config(
    token: Option<&str>,
    port: Option<&str>,
) -> Result<Option<AutomationConfig>, String> {
    let (Some(token), Some(port)) = (token, port) else {
        return Ok(None);
    };

    let token = token.trim();
    if token.len() < 32 || !token.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(format!(
            "{TOKEN_ENV} must contain at least 32 printable ASCII characters"
        ));
    }

    let port = port
        .trim()
        .parse::<u16>()
        .map_err(|_| format!("{PORT_ENV} must be an integer from 1024 to 65535"))?;
    if port < 1024 {
        return Err(format!("{PORT_ENV} must be an integer from 1024 to 65535"));
    }

    Ok(Some(AutomationConfig {
        bearer_token: token.to_string(),
        port,
    }))
}

fn take_config_from_env() -> Result<Option<AutomationConfig>, String> {
    let token = std::env::var(TOKEN_ENV).ok();
    let port = std::env::var(PORT_ENV).ok();
    // The desktop process spawns managed-agent subprocesses. Do not allow the
    // automation token to leak into their inherited environment.
    std::env::remove_var(TOKEN_ENV);
    std::env::remove_var(PORT_ENV);
    parse_config(token.as_deref(), port.as_deref())
}

fn authorize(headers: &HeaderMap, expected: &str) -> Result<(), AutomationError> {
    let supplied = headers
        .get(AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));
    if supplied == Some(expected) {
        Ok(())
    } else {
        Err(AutomationError::Unauthorized)
    }
}

async fn health(
    State(state): State<AutomationState>,
    headers: HeaderMap,
) -> Result<Json<HealthResponse>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    Ok(Json(HealthResponse { status: "ok" }))
}

async fn list_personas(
    State(state): State<AutomationState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AgentDefinition>>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::list_personas(state.app)
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

/// Update a persona through the same native command that the desktop editor
/// uses. This preserves the normal store validation and propagates display
/// name/avatar changes to linked managed agents and their relay profiles.
async fn update_persona_definition(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(persona_id): Path<String>,
    Json(input): Json<UpdatePersonaRequest>,
) -> Result<Json<AgentDefinition>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    if input.id != persona_id {
        return Err(AutomationError::BadRequest(
            "persona id in the path must match the request body".to_string(),
        ));
    }
    commands::update_persona(input, state.app)
        .await
        .map(|response| Json(response.persona))
        .map_err(AutomationError::BadRequest)
}

/// Delete a persona through Buzz's native cascade command. The command stops
/// and removes any linked managed-agent record, key material, and retained
/// identity; it refuses unsafe remote deployments before changing storage.
async fn delete_persona_definition(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(persona_id): Path<String>,
) -> Result<StatusCode, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::delete_persona(persona_id, state.app)
        .await
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(AutomationError::BadRequest)
}

async fn list_agents(
    State(state): State<AutomationState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ManagedAgentSummary>>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::list_managed_agents(state.app)
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

async fn list_teams(
    State(state): State<AutomationState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TeamRecord>>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::list_teams(state.app)
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

async fn create_persona_with_agent(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Json(input): Json<CreatePersonaWithAgentRequest>,
) -> Result<Json<CreatePersonaWithAgentResponse>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;

    let persona = commands::create_persona(input.persona, state.app.clone())
        .await
        .map_err(AutomationError::BadRequest)?;
    let instance = CreateManagedAgentRequest {
        name: persona.display_name.clone(),
        persona_id: Some(persona.id.clone()),
        team_id: None,
        relay_url: None,
        acp_command: Some("buzz-acp".to_string()),
        agent_command: None,
        harness_override: false,
        agent_args: input.agent_args,
        mcp_command: None,
        turn_timeout_seconds: None,
        idle_timeout_seconds: None,
        max_turn_duration_seconds: None,
        parallelism: None,
        system_prompt: None,
        avatar_url: persona.avatar_url.clone(),
        model: None,
        provider: None,
        env_vars: BTreeMap::new(),
        spawn_after_create: input.start_after_create,
        start_on_app_launch: input.start_on_app_launch,
        backend: BackendKind::Local,
        respond_to: None,
        respond_to_allowlist: Vec::new(),
        relay_mesh: None,
    };
    let created =
        commands::create_managed_agent(instance, state.app.clone(), state.app.state::<AppState>())
            .await
            .map_err(AutomationError::Internal)?;

    // The UI presents this secret once and never stores it in its response
    // cache. The automation API is deliberately stricter: key material never
    // leaves the Tauri command boundary.
    let agent = AutomationAgentResponse {
        agent: created.agent,
        profile_sync_error: created.profile_sync_error,
        spawn_error: created.spawn_error,
    };

    Ok(Json(CreatePersonaWithAgentResponse { persona, agent }))
}

async fn update_agent_args(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
    Json(input): Json<UpdateAgentArgsRequest>,
) -> Result<Json<ManagedAgentSummary>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::update_managed_agent(
        UpdateManagedAgentRequest {
            pubkey,
            name: None,
            model: None,
            system_prompt: None,
            env_vars: None,
            parallelism: None,
            turn_timeout_seconds: None,
            relay_url: None,
            acp_command: None,
            agent_command: None,
            harness_override: false,
            agent_args: Some(input.agent_args),
            mcp_command: None,
            provider: None,
            respond_to: None,
            respond_to_allowlist: None,
        },
        state.app.clone(),
        state.app.state::<AppState>(),
    )
    .await
    .map(|response| Json(response.agent))
    .map_err(AutomationError::Internal)
}

/// Persist whether a local managed agent should be restored on normal Buzz
/// startup. This delegates to the same narrowly-scoped command as the UI.
async fn update_agent_start_on_app_launch(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
    Json(input): Json<UpdateAgentStartOnAppLaunchRequest>,
) -> Result<Json<ManagedAgentSummary>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::set_managed_agent_start_on_app_launch(pubkey, input.start_on_app_launch, state.app)
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

async fn start_agent(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
) -> Result<Json<ManagedAgentSummary>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::start_managed_agent(pubkey, state.app.clone(), state.app.state::<AppState>())
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

async fn stop_agent(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(pubkey): Path<String>,
) -> Result<Json<ManagedAgentSummary>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::stop_managed_agent(pubkey, state.app.clone())
        .await
        .map(Json)
        .map_err(AutomationError::Internal)
}

async fn create_team(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Json(input): Json<CreateTeamRequest>,
) -> Result<Json<TeamRecord>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    commands::create_team(input, state.app)
        .await
        .map(Json)
        .map_err(AutomationError::BadRequest)
}

/// Update an existing team using the same validation and persistence path as
/// the desktop editor. It is used for presentation-only identity relabelling;
/// the full request makes membership replacement explicit and auditable.
async fn update_team_definition(
    State(state): State<AutomationState>,
    headers: HeaderMap,
    Path(team_id): Path<String>,
    Json(input): Json<UpdateTeamRequest>,
) -> Result<Json<TeamRecord>, AutomationError> {
    authorize(&headers, &state.bearer_token)?;
    if input.id != team_id {
        return Err(AutomationError::BadRequest(
            "team id in the path must match the request body".to_string(),
        ));
    }
    commands::update_team(input, state.app)
        .await
        .map(Json)
        .map_err(AutomationError::BadRequest)
}

/// Start the opt-in local automation API when both required environment
/// variables are present. It is bound to loopback only and never starts in a
/// normal Buzz launch.
pub fn spawn_if_configured(app: AppHandle) {
    let config = match take_config_from_env() {
        Ok(Some(config)) => config,
        Ok(None) => return,
        Err(error) => {
            eprintln!("buzz-desktop: local automation disabled: {error}");
            return;
        }
    };

    let state = AutomationState {
        app,
        bearer_token: Arc::from(config.bearer_token),
    };
    let port = config.port;
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!(
                    "buzz-desktop: local automation failed to bind 127.0.0.1:{port}: {error}"
                );
                return;
            }
        };
        let router = Router::new()
            .route("/v1/health", get(health))
            .route("/v1/personas", get(list_personas))
            .route(
                "/v1/personas/{persona_id}",
                patch(update_persona_definition).delete(delete_persona_definition),
            )
            .route("/v1/agents", get(list_agents))
            .route("/v1/agents/{pubkey}/args", patch(update_agent_args))
            .route(
                "/v1/agents/{pubkey}/start-on-app-launch",
                patch(update_agent_start_on_app_launch),
            )
            .route("/v1/agents/{pubkey}/start", post(start_agent))
            .route("/v1/agents/{pubkey}/stop", post(stop_agent))
            .route("/v1/teams", get(list_teams).post(create_team))
            .route("/v1/teams/{team_id}", patch(update_team_definition))
            .route("/v1/personas-with-agent", post(create_persona_with_agent))
            .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
            .with_state(state);

        eprintln!("buzz-desktop: local automation listening on 127.0.0.1:{port}");
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("buzz-desktop: local automation stopped: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::parse_config;

    #[test]
    fn requires_both_environment_variables() {
        assert_eq!(parse_config(Some("x"), None).unwrap(), None);
        assert_eq!(parse_config(None, Some("43121")).unwrap(), None);
    }

    #[test]
    fn accepts_a_safe_loopback_configuration() {
        let config = parse_config(Some(&"a".repeat(32)), Some("43121"))
            .unwrap()
            .expect("configuration");
        assert_eq!(config.port, 43121);
    }

    #[test]
    fn rejects_short_tokens_and_privileged_ports() {
        assert!(parse_config(Some("short"), Some("43121")).is_err());
        assert!(parse_config(Some(&"a".repeat(32)), Some("443")).is_err());
    }
}
