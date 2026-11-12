//! Mac app ChatGPT connection (Ticket 297, decision D27).
//!
//! Rust owns every token-endpoint call (code exchange, refresh and revocation), so the
//! refresh token never enters the webview. Tokens live only in two native-only Keychain
//! items, never in SQLite, frontend storage, logs, exports, backups or error text.
//! The webview gets connection state, the ChatGPT email and the model catalog rows.
//! No UI uses these commands yet; Ticket 299 adds it.

pub mod loopback;
pub mod protocol;
mod transport;

#[cfg(test)]
mod tests;

use loopback::{Loopback, CALLBACK_TIMEOUT};
use protocol::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use transport::{Http, Https, Keychain, Secrets};

/// Keychain account names under the app's `app.cadence.desktop.auth` service.
pub const INSTALLATION_ITEM: &str = "chatgpt-installation";
pub const SESSION_ITEM: &str = "chatgpt-session";

/// Created once per installation and kept on this Mac. The host ID and the issued
/// client ID are reused by every later sign-in and survive Disconnect.
#[derive(Serialize, Deserialize)]
struct Installation {
    host_id: String,
    client_id: Option<String>,
}

/// The connected account. No `Debug`: this struct holds tokens.
#[derive(Serialize, Deserialize)]
struct Session {
    client_id: String,
    subject: String,
    email: Option<String>,
    scopes: Vec<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: i64,
    needs_reconnect: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    ConnectedWithoutPlanUsage,
    ConnectedWithPlanUsage,
    NeedsReconnect,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: ConnectionState,
    pub email: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectOutcome {
    /// OpenAI accepted the revocation; local tokens are gone.
    Revoked,
    /// Revocation did not succeed; local tokens are gone anyway.
    RevocationFailed,
    /// Nothing was connected, or the grant was already gone.
    NotConnected,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectResult {
    pub outcome: DisconnectOutcome,
}

pub struct Connection<H: Http, S: Secrets> {
    http: H,
    secrets: S,
    now: Box<dyn Fn() -> i64 + Send + Sync>,
    retry_delay: Duration,
    /// Serializes every session read-modify-write, which makes refresh single-flight.
    session_lock: tauri::async_runtime::Mutex<()>,
    endpoints: Mutex<Option<Endpoints>>,
    pending: Mutex<Option<Arc<AtomicBool>>>,
}

fn system_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

/// Clears the pending sign-in slot on every exit path.
struct PendingGuard<'a>(&'a Mutex<Option<Arc<AtomicBool>>>);

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.0.lock() {
            *pending = None;
        }
    }
}

impl<H: Http, S: Secrets> Connection<H, S> {
    pub fn new(http: H, secrets: S) -> Self {
        Self::with_clock(http, secrets, Box::new(system_now), Duration::from_secs(1))
    }

    fn with_clock(
        http: H,
        secrets: S,
        now: Box<dyn Fn() -> i64 + Send + Sync>,
        retry_delay: Duration,
    ) -> Self {
        Connection {
            http,
            secrets,
            now,
            retry_delay,
            session_lock: tauri::async_runtime::Mutex::new(()),
            endpoints: Mutex::new(None),
            pending: Mutex::new(None),
        }
    }

    // -- storage ---------------------------------------------------------------

    fn load<T: serde::de::DeserializeOwned>(&self, item: &str) -> Result<Option<T>, Failure> {
        match self.secrets.get(item).map_err(|_| Failure::Storage)? {
            None => Ok(None),
            // An unreadable record is treated as absent, never echoed.
            Some(text) => Ok(serde_json::from_str(&text).ok()),
        }
    }

    fn save<T: Serialize>(&self, item: &str, value: &T) -> Result<(), Failure> {
        let text = serde_json::to_string(value).map_err(|_| Failure::Storage)?;
        self.secrets.set(item, text).map_err(|_| Failure::Storage)
    }

    fn installation(&self) -> Result<Installation, Failure> {
        if let Some(saved) = self.load::<Installation>(INSTALLATION_ITEM)? {
            if is_host_id(&saved.host_id) {
                let client_id = saved.client_id.filter(|id| valid_client_id(id));
                return Ok(Installation {
                    host_id: saved.host_id,
                    client_id,
                });
            }
        }
        let created = Installation {
            host_id: new_host_id()?,
            client_id: None,
        };
        self.save(INSTALLATION_ITEM, &created)?;
        Ok(created)
    }

    // -- status ----------------------------------------------------------------

    pub fn status(&self) -> Result<Status, Failure> {
        let Some(session) = self.load::<Session>(SESSION_ITEM)? else {
            return Ok(Status {
                state: ConnectionState::Disconnected,
                email: None,
            });
        };
        let state = if session.needs_reconnect || session.refresh_token.is_none() {
            ConnectionState::NeedsReconnect
        } else if session.scopes.iter().any(|scope| scope == PLAN_SCOPE) {
            ConnectionState::ConnectedWithPlanUsage
        } else {
            ConnectionState::ConnectedWithoutPlanUsage
        };
        Ok(Status {
            state,
            email: session.email,
        })
    }

    // -- discovery -------------------------------------------------------------

    async fn endpoints(&self) -> Result<Endpoints, Failure> {
        if let Some(cached) = self.endpoints.lock().ok().and_then(|value| value.clone()) {
            return Ok(cached);
        }
        let reply = self
            .http
            .get(DISCOVERY_URL, None)
            .await
            .map_err(|_| Failure::Unavailable)?;
        if reply.status != 200 {
            return Err(Failure::Discovery);
        }
        let endpoints = parse_discovery(&reply.body)?;
        if let Ok(mut cached) = self.endpoints.lock() {
            *cached = Some(endpoints.clone());
        }
        Ok(endpoints)
    }

    // -- connect ---------------------------------------------------------------

    /// Starts sign-in, opens the system browser and waits for one callback.
    pub async fn connect(
        &self,
        open_browser: impl FnOnce(&str) -> Result<(), Failure>,
        timeout: Duration,
    ) -> Result<Status, Failure> {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut pending = self.pending.lock().map_err(|_| Failure::Unavailable)?;
            if pending.is_some() {
                return Err(Failure::AlreadyConnecting);
            }
            *pending = Some(cancel.clone());
        }
        let _guard = PendingGuard(&self.pending);

        let endpoints = self.endpoints().await?;
        let installation = self.installation()?;
        let loopback = Loopback::bind()?;
        let attempt = Attempt::new(
            installation.client_id.as_deref(),
            &installation.host_id,
            loopback.redirect_uri(),
        )?;
        open_browser(&attempt.authorize_url(&endpoints.authorize))?;
        let waiting = cancel.clone();
        let params = tauri::async_runtime::spawn_blocking(move || loopback.wait(timeout, &waiting))
            .await
            .map_err(|_| Failure::Unavailable)??;
        if cancel.load(Ordering::SeqCst) {
            return Err(Failure::Cancelled);
        }
        let accepted = accept_callback(&params, &attempt)?;

        let body = encode_pairs(&[
            ("grant_type", "authorization_code"),
            ("client_id", &accepted.client_id),
            ("code", &accepted.code),
            ("code_verifier", &attempt.verifier),
            ("redirect_uri", &attempt.redirect_uri),
            ("resource", RESOURCE),
        ]);
        let reply = self
            .http
            .post_form(&endpoints.token, body)
            .await
            .map_err(|_| Failure::Unavailable)?;
        let tokens =
            parse_token_response(reply.status, &reply.body).map_err(|error| match error {
                TokenError::Unavailable => Failure::Unavailable,
                _ => Failure::TokenResponse,
            })?;
        if attempt.registering {
            // The issued client ID is reused by every later sign-in on this Mac.
            self.save(
                INSTALLATION_ITEM,
                &Installation {
                    host_id: installation.host_id.clone(),
                    client_id: Some(accepted.client_id.clone()),
                },
            )?;
        }
        let Some(refresh_token) = tokens.refresh_token.clone() else {
            return Err(Failure::TokenResponse);
        };
        let claims = match self
            .validate_id_token(
                &endpoints,
                tokens.id_token.as_deref(),
                &accepted.client_id,
                &attempt.nonce,
            )
            .await
        {
            Ok(claims) => claims,
            Err(failure) => {
                // Never keep, and never leave live, a grant Cadence could not verify.
                self.revoke(&endpoints, &accepted.client_id, &refresh_token)
                    .await;
                return Err(failure);
            }
        };
        let session = Session {
            client_id: accepted.client_id.clone(),
            subject: claims.subject,
            email: claims.email,
            scopes: granted_scopes(tokens.scope.as_deref().or(params.scope.as_deref())),
            access_token: Some(tokens.access_token),
            refresh_token: Some(refresh_token.clone()),
            expires_at: (self.now)() + tokens.expires_in,
            needs_reconnect: false,
        };
        let replaced = {
            let _session = self.session_lock.lock().await;
            // A cancel or Disconnect during the exchange wins: never save, and never leave live, this grant.
            // Disconnect sets the flag before it takes the lock, so it either sees this session or stops it here.
            if cancel.load(Ordering::SeqCst) {
                drop(_session);
                self.revoke(&endpoints, &accepted.client_id, &refresh_token)
                    .await;
                return Err(Failure::Cancelled);
            }
            let previous = self.load::<Session>(SESSION_ITEM).ok().flatten();
            self.save(SESSION_ITEM, &session)?;
            previous
        };
        if let Some(previous) = replaced {
            if let Some(old) = previous
                .refresh_token
                .filter(|old| Some(old) != session.refresh_token.as_ref())
            {
                self.revoke(&endpoints, &previous.client_id, &old).await;
            }
        }
        self.status()
    }

    async fn validate_id_token(
        &self,
        endpoints: &Endpoints,
        id_token: Option<&str>,
        client_id: &str,
        nonce: &str,
    ) -> Result<IdClaims, Failure> {
        let id_token = id_token.ok_or(Failure::IdToken)?;
        let jwks = self
            .http
            .get(&endpoints.jwks, None)
            .await
            .map_err(|_| Failure::Unavailable)?;
        if jwks.status != 200 {
            return Err(Failure::IdToken);
        }
        verify_id_token(id_token, &jwks.body, client_id, nonce, (self.now)())
    }

    pub fn cancel_connect(&self) {
        if let Some(flag) = self.pending.lock().ok().and_then(|value| value.clone()) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    // -- refresh ---------------------------------------------------------------

    /// Returns a usable access token, refreshing at most once across concurrent
    /// callers. `rejected` forces a refresh only if it is still the stored token.
    async fn access_token(&self, rejected: Option<&str>) -> Result<String, Failure> {
        let _session = self.session_lock.lock().await;
        let mut session = self
            .load::<Session>(SESSION_ITEM)?
            .ok_or(Failure::Disconnected)?;
        if session.needs_reconnect {
            return Err(Failure::NeedsReconnect);
        }
        let stale = rejected.is_some_and(|token| session.access_token.as_deref() == Some(token));
        if let Some(token) = session.access_token.as_ref() {
            if !stale && session.expires_at - (self.now)() > REFRESH_MARGIN_SECONDS {
                return Ok(token.clone());
            }
        }
        let Some(refresh_token) = session.refresh_token.clone() else {
            return Err(self.mark_reconnect(session));
        };
        let endpoints = self.endpoints().await?;
        // No `scope`: the refresh keeps the original grant.
        let body = encode_pairs(&[
            ("grant_type", "refresh_token"),
            ("client_id", &session.client_id),
            ("refresh_token", &refresh_token),
            ("resource", RESOURCE),
        ]);
        let reply = self
            .http
            .post_form(&endpoints.token, body)
            .await
            .map_err(|_| Failure::Unavailable)?;
        match parse_token_response(reply.status, &reply.body) {
            Ok(tokens) => {
                if let Some(rotated) = tokens.refresh_token {
                    session.refresh_token = Some(rotated);
                }
                if tokens.scope.is_some() {
                    session.scopes = granted_scopes(tokens.scope.as_deref());
                }
                session.expires_at = (self.now)() + tokens.expires_in;
                session.access_token = Some(tokens.access_token.clone());
                // Save the rotated refresh token before anything uses the new access token.
                self.save(SESSION_ITEM, &session)?;
                Ok(tokens.access_token)
            }
            Err(TokenError::Rejected) => Err(self.mark_reconnect(session)),
            Err(_) => Err(Failure::Unavailable),
        }
    }

    /// Drops the tokens but keeps the account label, so the UI can say whom to reconnect.
    fn mark_reconnect(&self, mut session: Session) -> Failure {
        session.access_token = None;
        session.refresh_token = None;
        session.needs_reconnect = true;
        match self.save(SESSION_ITEM, &session) {
            Ok(()) => Failure::NeedsReconnect,
            Err(failure) => failure,
        }
    }

    // -- catalog ---------------------------------------------------------------

    pub async fn models(&self) -> Result<Vec<CatalogModel>, Failure> {
        let token = self.access_token(None).await?;
        let mut reply = self
            .http
            .get(CATALOG_URL, Some(&token))
            .await
            .map_err(|_| Failure::Unavailable)?;
        if reply.status == 401 {
            let refreshed = self.access_token(Some(&token)).await?;
            reply = self
                .http
                .get(CATALOG_URL, Some(&refreshed))
                .await
                .map_err(|_| Failure::Unavailable)?;
            if reply.status == 401 {
                let _session = self.session_lock.lock().await;
                return match self.load::<Session>(SESSION_ITEM)? {
                    // Only the session that owns the rejected token is marked; a replacement stays intact.
                    Some(session)
                        if session.access_token.as_deref() == Some(refreshed.as_str()) =>
                    {
                        Err(self.mark_reconnect(session))
                    }
                    Some(_) => Err(Failure::Unavailable),
                    None => Err(Failure::Disconnected),
                };
            }
        }
        match reply.status {
            200 => parse_catalog(&reply.body),
            429 | 500.. => Err(Failure::Unavailable),
            _ => Err(Failure::Catalog),
        }
    }

    // -- disconnect ------------------------------------------------------------

    /// Revokes the refresh token at OpenAI, then clears local tokens either way.
    pub async fn disconnect(&self) -> Result<DisconnectResult, Failure> {
        self.cancel_connect();
        let _session = self.session_lock.lock().await;
        let session = self.load::<Session>(SESSION_ITEM)?;
        let outcome = match session
            .as_ref()
            .and_then(|value| value.refresh_token.as_ref().map(|token| (value, token)))
        {
            None => DisconnectOutcome::NotConnected,
            Some((value, token)) => match self.endpoints().await {
                Ok(endpoints) if self.revoke(&endpoints, &value.client_id, token).await => {
                    DisconnectOutcome::Revoked
                }
                _ => DisconnectOutcome::RevocationFailed,
            },
        };
        self.secrets
            .remove(SESSION_ITEM)
            .map_err(|_| Failure::Storage)?;
        Ok(DisconnectResult { outcome })
    }

    /// A 200 means revoked, including an already-invalid token. Retries network
    /// errors and 5xx up to three attempts.
    async fn revoke(&self, endpoints: &Endpoints, client_id: &str, refresh_token: &str) -> bool {
        for attempt in 1..=3u32 {
            let body = encode_pairs(&[
                ("token", refresh_token),
                ("token_type_hint", "refresh_token"),
                ("client_id", client_id),
            ]);
            match self.http.post_form(&endpoints.revocation, body).await {
                Ok(reply) if reply.status == 200 => return true,
                Ok(reply) if reply.status < 500 => return false,
                _ => {}
            }
            if attempt < 3 && !self.retry_delay.is_zero() {
                let delay = self.retry_delay * attempt;
                let _ =
                    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay)).await;
            }
        }
        false
    }
}

// ---------------------------------------------------------------------------
// Tauri commands. Errors are fixed sentences from `Failure::message`.

pub struct ChatGptState(Connection<Https, Keychain>);

impl Default for ChatGptState {
    fn default() -> Self {
        ChatGptState(Connection::new(Https::default(), Keychain))
    }
}

fn text(failure: Failure) -> String {
    failure.message().to_owned()
}

#[tauri::command]
pub fn chatgpt_status(state: State<'_, ChatGptState>) -> Result<Status, String> {
    state.0.status().map_err(text)
}

#[tauri::command]
pub async fn chatgpt_connect(state: State<'_, ChatGptState>) -> Result<Status, String> {
    state
        .0
        .connect(
            |url| crate::auth::open_https_url(url).map_err(|_| Failure::Unavailable),
            CALLBACK_TIMEOUT,
        )
        .await
        .map_err(text)
}

#[tauri::command]
pub fn chatgpt_cancel_connect(state: State<'_, ChatGptState>) -> Result<(), String> {
    state.0.cancel_connect();
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_disconnect(
    state: State<'_, ChatGptState>,
) -> Result<DisconnectResult, String> {
    state.0.disconnect().await.map_err(text)
}

#[tauri::command]
pub async fn chatgpt_models(state: State<'_, ChatGptState>) -> Result<Vec<CatalogModel>, String> {
    state.0.models().await.map_err(text)
}
