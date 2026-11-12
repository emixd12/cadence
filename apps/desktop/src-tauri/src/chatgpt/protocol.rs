//! Sign in with ChatGPT protocol details (Ticket 297, decision D27).
//!
//! Written from OpenAI's public docs and the proven dev spike
//! (`scripts/chatgpt-plan-spike.ts`). No DevKit code. Every function here is pure
//! or takes its inputs explicitly, so tests need no network.
//!
//! Secrets rule: no value in this module is ever logged, and no error carries a
//! token, code, verifier or nonce.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const ISSUER: &str = "https://auth.openai.com";
pub const DISCOVERY_URL: &str = "https://auth.openai.com/.well-known/openid-configuration";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const CATALOG_URL: &str = "https://api.openai.com/v1/models";
pub const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
pub const AGENT_NAME_HINT: &str = "Cadence";
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const CALLBACK_PATH: &str = "/auth/callback";
/// Refresh this long before the access token expires.
pub const REFRESH_MARGIN_SECONDS: i64 = 5 * 60;
const ID_TOKEN_SKEW_SECONDS: i64 = 60;

/// Fixed, token-free failure reasons. `message` is the only text that leaves Rust.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Disconnected,
    NeedsReconnect,
    Unavailable,
    Cancelled,
    TimedOut,
    Denied,
    AlreadyConnecting,
    Storage,
    Discovery,
    Callback,
    Registration,
    TokenResponse,
    IdToken,
    Catalog,
}

impl Failure {
    pub fn message(self) -> &'static str {
        match self {
            Failure::Disconnected => "ChatGPT is not connected.",
            Failure::NeedsReconnect => "Reconnect ChatGPT to continue.",
            Failure::Unavailable => "ChatGPT could not be reached. Try again later.",
            Failure::Cancelled => "ChatGPT sign-in was cancelled.",
            Failure::TimedOut => "ChatGPT sign-in timed out. Start again.",
            Failure::Denied => "ChatGPT sign-in was cancelled or denied.",
            Failure::AlreadyConnecting => "A ChatGPT sign-in is already in progress.",
            Failure::Storage => "macOS Keychain could not save the ChatGPT connection.",
            Failure::Discovery => "ChatGPT sign-in is unavailable right now.",
            Failure::Callback => "Cadence rejected the ChatGPT sign-in callback. Start again.",
            Failure::Registration => "ChatGPT did not finish registering Cadence. Start again.",
            Failure::TokenResponse => "ChatGPT sign-in could not be completed. Start again.",
            Failure::IdToken => "Cadence could not verify the ChatGPT account. Start again.",
            Failure::Catalog => "The ChatGPT model list could not be read.",
        }
    }
}

// ---------------------------------------------------------------------------
// Encoding and randomness

/// Percent-encodes like JavaScript's `encodeURIComponent` (spaces as %20), which
/// matches the authorize URL the spike proved live.
pub fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        let keep = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn encode_pairs(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", encode_component(key), encode_component(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Decodes one query component (`+` is a space). Invalid UTF-8 is rejected.
pub fn decode_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' => {
                let hex = value.get(index + 1..index + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 2;
            }
            other => out.push(other),
        }
        index += 1;
    }
    String::from_utf8(out).ok()
}

pub fn query_value(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (decode_component(key)? == name)
            .then(|| decode_component(value))
            .flatten()
    })
}

pub fn random_bytes<const N: usize>() -> Result<[u8; N], Failure> {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; N];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| Failure::Unavailable)?;
    Ok(bytes)
}

pub fn random_token<const N: usize>() -> Result<String, Failure> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<N>()?))
}

/// A random (version 4) UUID as a `urn:uuid:` host ID.
pub fn new_host_id() -> Result<String, Failure> {
    let mut bytes = random_bytes::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

pub fn is_host_id(value: &str) -> bool {
    let Some(uuid) = value.strip_prefix("urn:uuid:") else {
        return false;
    };
    uuid.len() == 36
        && uuid.char_indices().all(|(index, character)| {
            if [8, 13, 18, 23].contains(&index) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn same_secret(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

// ---------------------------------------------------------------------------
// Discovery

/// Endpoints read from OpenID discovery. Each must sit on the issuer's origin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub jwks: String,
    pub revocation: String,
}

fn on_issuer(url: &str) -> bool {
    url.strip_prefix(ISSUER)
        .is_some_and(|rest| rest.starts_with('/') && !rest.contains(['?', '#', '@', '\\']))
}

pub fn parse_discovery(body: &[u8]) -> Result<Endpoints, Failure> {
    let document: Value = serde_json::from_slice(body).map_err(|_| Failure::Discovery)?;
    let text = |key: &str| document.get(key).and_then(Value::as_str).map(str::to_owned);
    if text("issuer").as_deref() != Some(ISSUER) {
        return Err(Failure::Discovery);
    }
    let endpoints = Endpoints {
        authorize: text("authorization_endpoint").ok_or(Failure::Discovery)?,
        token: text("token_endpoint").ok_or(Failure::Discovery)?,
        jwks: text("jwks_uri").ok_or(Failure::Discovery)?,
        // A token Cadence cannot revoke is never requested.
        revocation: text("revocation_endpoint").ok_or(Failure::Discovery)?,
    };
    for url in [
        &endpoints.authorize,
        &endpoints.token,
        &endpoints.jwks,
        &endpoints.revocation,
    ] {
        if !on_issuer(url) {
            return Err(Failure::Discovery);
        }
    }
    Ok(endpoints)
}

// ---------------------------------------------------------------------------
// Authorization request and callback

/// One sign-in attempt. Lives only in memory for the life of the listener.
pub struct Attempt {
    pub client_id: String,
    pub host_id: String,
    pub redirect_uri: String,
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub registering: bool,
}

impl Attempt {
    pub fn new(
        client_id: Option<&str>,
        host_id: &str,
        redirect_uri: String,
    ) -> Result<Self, Failure> {
        Ok(Attempt {
            client_id: client_id.unwrap_or(DYNAMIC_CLIENT_ID).to_owned(),
            host_id: host_id.to_owned(),
            redirect_uri,
            state: random_token::<32>()?,
            nonce: random_token::<32>()?,
            verifier: random_token::<48>()?,
            registering: client_id.is_none(),
        })
    }

    pub fn authorize_url(&self, authorize_endpoint: &str) -> String {
        let challenge = pkce_challenge(&self.verifier);
        let mut pairs: Vec<(&str, &str)> = vec![("client_id", &self.client_id)];
        if self.registering {
            pairs.push(("agent_name_hint", AGENT_NAME_HINT));
        }
        pairs.extend([
            ("ext_agent_host_id", self.host_id.as_str()),
            ("response_type", "code"),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("scope", SCOPES),
            ("resource", RESOURCE),
            ("state", self.state.as_str()),
            ("nonce", self.nonce.as_str()),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge.as_str()),
        ]);
        format!("{authorize_endpoint}?{}", encode_pairs(&pairs))
    }
}

#[derive(Default)]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub client_id: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
}

impl CallbackParams {
    pub fn from_query(query: &str) -> Self {
        CallbackParams {
            code: query_value(query, "code"),
            state: query_value(query, "state"),
            client_id: query_value(query, "client_id"),
            scope: query_value(query, "scope"),
            error: query_value(query, "error"),
        }
    }
}

pub struct Accepted {
    pub code: String,
    pub client_id: String,
}

/// Checks state first, then provider errors, then the code and the client ID.
pub fn accept_callback(params: &CallbackParams, attempt: &Attempt) -> Result<Accepted, Failure> {
    match params.state.as_deref() {
        Some(state) if same_secret(state, &attempt.state) => {}
        _ => return Err(Failure::Callback),
    }
    if let Some(error) = params.error.as_deref() {
        return Err(if error == "access_denied" {
            Failure::Denied
        } else {
            Failure::Callback
        });
    }
    let code = params
        .code
        .clone()
        .filter(|code| !code.is_empty() && code.len() <= 4096)
        .ok_or(Failure::Callback)?;
    if attempt.registering {
        let client_id = params
            .client_id
            .clone()
            .filter(|id| valid_client_id(id))
            .ok_or(Failure::Registration)?;
        return Ok(Accepted { code, client_id });
    }
    if params
        .client_id
        .as_deref()
        .is_some_and(|id| id != attempt.client_id)
    {
        return Err(Failure::Callback);
    }
    Ok(Accepted {
        code,
        client_id: attempt.client_id.clone(),
    })
}

pub fn valid_client_id(value: &str) -> bool {
    !value.is_empty()
        && value != DYNAMIC_CLIENT_ID
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

// ---------------------------------------------------------------------------
// Token endpoint

pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub scope: Option<String>,
    pub expires_in: i64,
}

/// `Rejected` means the grant is gone (reconnect); `Unavailable` is worth a later retry.
#[derive(Debug, PartialEq, Eq)]
pub enum TokenError {
    Rejected,
    Unavailable,
    Malformed,
}

pub fn parse_token_response(status: u16, body: &[u8]) -> Result<TokenSet, TokenError> {
    if status >= 500 || status == 429 {
        return Err(TokenError::Unavailable);
    }
    if status != 200 {
        return Err(TokenError::Rejected);
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| TokenError::Malformed)?;
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    Ok(TokenSet {
        access_token: text("access_token").ok_or(TokenError::Malformed)?,
        refresh_token: text("refresh_token"),
        id_token: text("id_token"),
        scope: text("scope"),
        expires_in: value
            .get("expires_in")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .unwrap_or(3600),
    })
}

pub fn granted_scopes(scope: Option<&str>) -> Vec<String> {
    let mut scopes: Vec<String> = scope
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    scopes.sort();
    scopes.dedup();
    scopes
}

// ---------------------------------------------------------------------------
// ID token (RS256 against the JWKS)

pub struct IdClaims {
    pub subject: String,
    pub email: Option<String>,
}

fn json_part(part: &str) -> Result<Value, Failure> {
    let bytes = URL_SAFE_NO_PAD.decode(part).map_err(|_| Failure::IdToken)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| Failure::IdToken)?;
    value.is_object().then_some(value).ok_or(Failure::IdToken)
}

pub fn verify_id_token(
    id_token: &str,
    jwks: &[u8],
    client_id: &str,
    nonce: &str,
    now_seconds: i64,
) -> Result<IdClaims, Failure> {
    let parts: Vec<&str> = id_token.split('.').collect();
    let [encoded_header, encoded_payload, encoded_signature] = parts[..] else {
        return Err(Failure::IdToken);
    };
    let header = json_part(encoded_header)?;
    let payload = json_part(encoded_payload)?;
    if header.get("alg").and_then(Value::as_str) != Some("RS256") {
        return Err(Failure::IdToken);
    }
    let kid = header.get("kid").and_then(Value::as_str);
    let jwks: Value = serde_json::from_slice(jwks).map_err(|_| Failure::IdToken)?;
    let key = jwks
        .get("keys")
        .and_then(Value::as_array)
        .and_then(|keys| {
            keys.iter().find(|key| {
                key.get("kid").and_then(Value::as_str) == kid
                    && key.get("kty").and_then(Value::as_str) == Some("RSA")
                    && key
                        .get("use")
                        .and_then(Value::as_str)
                        .is_none_or(|usage| usage == "sig")
            })
        })
        .ok_or(Failure::IdToken)?;
    let component = |name: &str| {
        key.get(name)
            .and_then(Value::as_str)
            .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
            .ok_or(Failure::IdToken)
    };
    let public_key = ring::signature::RsaPublicKeyComponents {
        n: component("n")?,
        e: component("e")?,
    };
    let signature = URL_SAFE_NO_PAD
        .decode(encoded_signature)
        .map_err(|_| Failure::IdToken)?;
    public_key
        .verify(
            &ring::signature::RSA_PKCS1_2048_8192_SHA256,
            format!("{encoded_header}.{encoded_payload}").as_bytes(),
            &signature,
        )
        .map_err(|_| Failure::IdToken)?;

    if payload.get("iss").and_then(Value::as_str) != Some(ISSUER) {
        return Err(Failure::IdToken);
    }
    let audiences: Vec<&str> = match payload.get("aud") {
        Some(Value::String(one)) => vec![one.as_str()],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    };
    if !audiences.contains(&client_id) {
        return Err(Failure::IdToken);
    }
    if audiences.len() > 1 && payload.get("azp").and_then(Value::as_str) != Some(client_id) {
        return Err(Failure::IdToken);
    }
    match payload.get("exp").and_then(Value::as_i64) {
        Some(exp) if exp > now_seconds - ID_TOKEN_SKEW_SECONDS => {}
        _ => return Err(Failure::IdToken),
    }
    if payload
        .get("iat")
        .and_then(Value::as_i64)
        .is_some_and(|iat| iat > now_seconds + ID_TOKEN_SKEW_SECONDS)
    {
        return Err(Failure::IdToken);
    }
    match payload.get("nonce").and_then(Value::as_str) {
        Some(value) if same_secret(value, nonce) => {}
        _ => return Err(Failure::IdToken),
    }
    let subject = payload
        .get("sub")
        .and_then(Value::as_str)
        .filter(|sub| !sub.is_empty() && sub.len() <= 256)
        .ok_or(Failure::IdToken)?
        .to_owned();
    let email = payload
        .get("email")
        .and_then(Value::as_str)
        .filter(|email| email.len() <= 320)
        .map(str::to_owned);
    Ok(IdClaims { subject, email })
}

// ---------------------------------------------------------------------------
// Model catalog

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub slug: String,
    pub visibility: Option<String>,
}

/// Reads `models` or `data` rows; the slug is `slug`, else `id`.
pub fn parse_catalog(body: &[u8]) -> Result<Vec<CatalogModel>, Failure> {
    let value: Value = serde_json::from_slice(body).map_err(|_| Failure::Catalog)?;
    let rows = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)
        .ok_or(Failure::Catalog)?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let slug = row
                .get("slug")
                .or_else(|| row.get("id"))
                .and_then(Value::as_str)
                .filter(|slug| !slug.is_empty() && slug.len() <= 128)?;
            Some(CatalogModel {
                slug: slug.to_owned(),
                visibility: row
                    .get("visibility")
                    .and_then(Value::as_str)
                    .filter(|value| value.len() <= 64)
                    .map(str::to_owned),
            })
        })
        .collect())
}
