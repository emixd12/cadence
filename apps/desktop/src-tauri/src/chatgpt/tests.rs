//! Ticket 297 tests. Every network call and Keychain item is a mock; nothing here
//! reaches OpenAI. The RSA key below is a throwaway key made for these tests only.

use super::protocol::*;
use super::transport::{Http, NetworkError, Reply, Secrets};
use super::*;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicI64, AtomicUsize};

const TEST_KEY_PKCS8: &[&str] = &[
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDRWXYW0klO0LRdeQyZHypl37QVMYIl2o28kmXWiTp2r47B",
    "ZMhIlTcGJuz4Nfh8ZNgoKte7UvY93ZUs7Hv0a+y/Cxwc1HnlfV9Pr24c65usZ8xHlbZmS+SoONicaIEBU47CGiDQYZ1V5dk+",
    "iujzekZbV4rra3hm54KRX5jSCmEIuyxKorqYNEhbyZMNpPZXwDOQTBAZ0qHfXwSlXzO6xxhFGlmDLFCygPPC1IvpAvKHMYDF",
    "UBj9CsVhuMQ3h9ZNTkhDHQr9EFWoZS+ht5JXTu/pLmXc0gZikAgSKFMSPRNqMShcAjBDv5dFLQkxo7/DBKRKq2knBqTIsQTc",
    "FWdz55AJAgMBAAECggEAAKQWBpDZN5IDBqpYR6ZMGRuQbnp5I8N9ePacSk2+WXr4TwrEVokjpVyuxk7QQtf1iCG89+mu6bHe",
    "7clczAHBK+amEtbevWtVqUAknKg3RDAeZVDpnZYBLeW2qKc9rwwCWjfkUHfDFSvUtGEF6YmsNUlVITFkk2se62soYI5+N++Q",
    "7OtLFE78VSf8aH/Fr/pnGbuEwSMQmviW/XoDgNNIZIJ/tq4NmB+8cQC9nPn1+kBzLWDCGJxsyCFBhz2O9r9JUuYVkpXiB2Dq",
    "20LWMVH3JTgpUlsWIInw/TEqcNJa8O4UwVmiq9FYQV2M9L5R9cYc6B2r4aGcS0xS1WtA/7bzHQKBgQDwp3t0+UYUsm831LzB",
    "MYfiUEsF7s5k2rBpqjEUmkRfueVdpJWd9Y/B++tQw0JmURT2hYNCAUB79+Sgybv2PwnDBll5WM4wp0yfAdwN7rvMiFGsMpJs",
    "o4gsDUsQX5WYbUrNMVt9/n6UFp+1WU+tys+ftv597KWTTvi7DXzMTJgljwKBgQDesvMm5X6f4A/6bDQYJAM6O0jeZUn47ZZP",
    "4KNR2vhYw4h2J8MJXuz4BGDDt13BRRjli9ZJ2QSk3yPc+2Ne25QXwX2/1v/rSs47lFL8Ut79+S3tJOezVSsYrjMKK0BFPj7B",
    "jPQAa3DJ1Tx4zyoOjKenqNTHgoIQGFNlvpiVUymU5wKBgQC3ewpOugtrlkvjpmgvaAMxUoSQxm1ISdA9D8yR57h/v60Xw3dr",
    "UqFDhj34epbyiZlRB6R2u5udqPgAey665X8c2Yd4VHQIdlWd2f4cBUvb+odCoeAvwlL9OzljB214JMPmRF58Zn+9iq5Dxw9P",
    "8xRvskbAXaAz+v77JqJi5XcPEwKBgDTK1zlxTgM4apFC9VaDswAq7atK9647JFbrOcw9zIG+WKsp4eJmzmY9I3NCFMesSaqg",
    "67u15pPvEeFg9r2V8BVxmQ3ROfndUeZt0v5d5t7uIyUEiqjIl97R7OeMOUAw8U+QyocO8T3nft5kveOVFGl6bHafSZXnLl4A",
    "QMulW0YhAoGAULikIYaiL7Dd9kz9S1N3Ypw76ODS8b6OT/h1g4SxiYxEu9w4BtTtTtIi56Gm0A7oVuDpL791fr79kcombLM8",
    "+X+rRr/iFUYSDWHe+tsbSZ1UThzsHvfhqF+6cFZ7wqXKs+VsjeivN1vtjwUQyxyGNTcovtdSenb6STN5DKUI1lI=",
];
const NOW: i64 = 1_794_441_600; // 2026-11-12T00:00:00Z
const ISSUED_CLIENT: &str = "oaiapp_test_client";
const PLAN_SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const REVOKE_URL: &str = "https://auth.openai.com/api/accounts/oauth/revoke";
const JWKS_URL: &str = "https://auth.openai.com/.well-known/jwks.json";
const HOST: &str = "urn:uuid:00000000-0000-4000-8000-000000000000";

fn key_pair() -> ring::rsa::KeyPair {
    let der = STANDARD.decode(TEST_KEY_PKCS8.concat()).unwrap();
    ring::rsa::KeyPair::from_pkcs8(&der).unwrap()
}

fn jwks() -> String {
    let public = ring::rsa::PublicKeyComponents::<Vec<u8>>::from(key_pair().public());
    json!({"keys":[{"kty":"RSA","kid":"test-key","use":"sig","alg":"RS256",
        "n":URL_SAFE_NO_PAD.encode(public.n),"e":URL_SAFE_NO_PAD.encode(public.e)}]})
    .to_string()
}

fn sign(header: Value, claims: Value) -> String {
    let message = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let pair = key_pair();
    let mut signature = vec![0u8; pair.public().modulus_len()];
    pair.sign(
        &ring::signature::RSA_PKCS1_SHA256,
        &ring::rand::SystemRandom::new(),
        message.as_bytes(),
        &mut signature,
    )
    .unwrap();
    format!("{message}.{}", URL_SAFE_NO_PAD.encode(signature))
}

fn claims(nonce: &str) -> Value {
    json!({"iss":ISSUER,"aud":ISSUED_CLIENT,"sub":"user-subject","email":"person@example.test",
        "nonce":nonce,"iat":NOW,"exp":NOW+3600})
}

fn id_token(nonce: &str) -> String {
    sign(
        json!({"alg":"RS256","kid":"test-key","typ":"JWT"}),
        claims(nonce),
    )
}

fn discovery() -> String {
    json!({"issuer":ISSUER,"authorization_endpoint":"https://auth.openai.com/api/accounts/authorize",
        "token_endpoint":TOKEN_URL,"jwks_uri":JWKS_URL,"revocation_endpoint":REVOKE_URL})
    .to_string()
}

// ---------------------------------------------------------------------------
// Mocks

#[derive(Default)]
struct Mock {
    events: Mutex<Vec<String>>,
    nonce: Mutex<Option<String>>,
    challenge: Mutex<Option<String>>,
    token_scope: Mutex<Option<String>>,
    bad_nonce: AtomicBool,
    refresh_statuses: Mutex<VecDeque<u16>>,
    revoke_replies: Mutex<VecDeque<Option<u16>>>,
    catalog_statuses: Mutex<VecDeque<u16>>,
    issued: AtomicUsize,
    refreshes: AtomicUsize,
    secrets: Mutex<HashMap<String, String>>,
}

impl Mock {
    fn event(&self, value: String) {
        self.events.lock().unwrap().push(value);
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
    fn issue(&self) -> (String, String) {
        let number = self.issued.fetch_add(1, Ordering::SeqCst) + 1;
        (
            format!("at-SECRET-access-{number}-xxxxxxxx"),
            format!("rt-SECRET-refresh-{number}-xxxxxxxx"),
        )
    }
    fn session(&self) -> Option<Value> {
        self.secrets
            .lock()
            .unwrap()
            .get(SESSION_ITEM)
            .map(|text| serde_json::from_str(text).unwrap())
    }
    /// The marker in every issued token, the issued client ID and the host ID.
    fn secret_values(&self) -> Vec<String> {
        let mut values = vec!["SECRET".to_owned(), ISSUED_CLIENT.to_owned()];
        if let Some(text) = self.secrets.lock().unwrap().get(INSTALLATION_ITEM) {
            let saved: Value = serde_json::from_str(text).unwrap();
            values.push(saved["host_id"].as_str().unwrap().to_owned());
        }
        values
    }
}

#[derive(Clone)]
struct MockHttp(Arc<Mock>);
#[derive(Clone)]
struct MockSecrets(Arc<Mock>);

fn reply(status: u16, body: impl Into<String>) -> Result<Reply, NetworkError> {
    Ok(Reply {
        status,
        body: body.into().into_bytes(),
    })
}

impl Http for MockHttp {
    async fn get(&self, url: &str, bearer: Option<&str>) -> Result<Reply, NetworkError> {
        let mock = &self.0;
        mock.event(format!("GET {url}"));
        match url {
            DISCOVERY_URL => reply(200, discovery()),
            JWKS_URL => reply(200, jwks()),
            CATALOG_URL => {
                assert!(bearer.is_some_and(|token| token.starts_with("at-SECRET-access-")));
                let status = mock
                    .catalog_statuses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or(200);
                reply(
                    status,
                    json!({"models":[
                    {"slug":"gpt-5.5-mini","visibility":"list","display_name":"x"},
                    {"id":"gpt-hidden","visibility":"hide"},
                    {"slug":"gpt-plain"},
                    {"display_name":"no slug"}]})
                    .to_string(),
                )
            }
            _ => Err(NetworkError),
        }
    }

    async fn post_form(&self, url: &str, body: String) -> Result<Reply, NetworkError> {
        let mock = &self.0;
        let field = |name: &str| query_value(&body, name);
        match url {
            TOKEN_URL => {
                match field("grant_type").as_deref() {
                    Some("authorization_code") => {
                        mock.event("POST token authorization_code".into());
                        assert_eq!(field("client_id").as_deref(), Some(ISSUED_CLIENT));
                        assert_eq!(field("resource").as_deref(), Some(RESOURCE));
                        let verifier = field("code_verifier").unwrap();
                        assert_eq!(
                            Some(pkce_challenge(&verifier)),
                            mock.challenge.lock().unwrap().clone()
                        );
                        let nonce = if mock.bad_nonce.load(Ordering::SeqCst) {
                            "wrong".to_owned()
                        } else {
                            mock.nonce.lock().unwrap().clone().unwrap()
                        };
                        let (access, refresh) = mock.issue();
                        let mut response = json!({"access_token":access,"refresh_token":refresh,
                        "id_token":id_token(&nonce),"expires_in":3599,"token_type":"Bearer"});
                        if let Some(scope) = mock.token_scope.lock().unwrap().clone() {
                            response["scope"] = json!(scope);
                        }
                        reply(200, response.to_string())
                    }
                    Some("refresh_token") => {
                        mock.refreshes.fetch_add(1, Ordering::SeqCst);
                        mock.event(format!(
                            "POST token refresh_token {}",
                            field("refresh_token").unwrap()
                        ));
                        assert!(field("scope").is_none());
                        assert_eq!(field("resource").as_deref(), Some(RESOURCE));
                        let status = mock
                            .refresh_statuses
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or(200);
                        if status != 200 {
                            // A hostile body that echoes the token must not reach any error text.
                            return reply(
                                status,
                                json!({"error":"invalid_grant",
                            "error_description":field("refresh_token")})
                                .to_string(),
                            );
                        }
                        let (access, refresh) = mock.issue();
                        reply(200, json!({"access_token":access,"refresh_token":refresh,"expires_in":3599})
                        .to_string())
                    }
                    _ => reply(400, "{}"),
                }
            }
            REVOKE_URL => {
                mock.event(format!("POST revoke {}", field("token").unwrap()));
                assert_eq!(field("token_type_hint").as_deref(), Some("refresh_token"));
                assert!(field("client_id").is_some());
                match mock
                    .revoke_replies
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or(Some(200))
                {
                    Some(status) => reply(status, ""),
                    None => Err(NetworkError),
                }
            }
            _ => Err(NetworkError),
        }
    }
}

impl Secrets for MockSecrets {
    fn get(&self, name: &str) -> Result<Option<String>, ()> {
        assert!(crate::auth::NATIVE_ONLY_KEYS.contains(&name));
        Ok(self.0.secrets.lock().unwrap().get(name).cloned())
    }
    fn set(&self, name: &str, value: String) -> Result<(), ()> {
        assert!(crate::auth::NATIVE_ONLY_KEYS.contains(&name));
        self.0.event(format!("keychain set {name}"));
        self.0
            .secrets
            .lock()
            .unwrap()
            .insert(name.to_owned(), value);
        Ok(())
    }
    fn remove(&self, name: &str) -> Result<(), ()> {
        assert!(crate::auth::NATIVE_ONLY_KEYS.contains(&name));
        self.0.event(format!("keychain remove {name}"));
        self.0.secrets.lock().unwrap().remove(name);
        Ok(())
    }
}

struct Harness {
    mock: Arc<Mock>,
    clock: Arc<AtomicI64>,
    connection: Arc<Connection<MockHttp, MockSecrets>>,
}

fn harness() -> Harness {
    let mock = Arc::new(Mock::default());
    let clock = Arc::new(AtomicI64::new(NOW));
    let reader = clock.clone();
    let connection = Connection::with_clock(
        MockHttp(mock.clone()),
        MockSecrets(mock.clone()),
        Box::new(move || reader.load(Ordering::SeqCst)),
        Duration::ZERO,
    );
    Harness {
        mock,
        clock,
        connection: Arc::new(connection),
    }
}

fn address(redirect_uri: &str) -> String {
    redirect_uri
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap()
        .to_owned()
}

fn http_get(redirect_uri: &str, target: &str) -> String {
    let mut stream = std::net::TcpStream::connect(address(redirect_uri)).unwrap();
    write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response
}

type Browser = Box<dyn FnOnce(&str) -> Result<(), Failure> + Send>;

/// Plays the browser: records the authorize URL, then calls the loopback with a
/// stray request first and the callback second.
fn browser(
    mock: Arc<Mock>,
    callback: impl FnOnce(&HashMap<String, String>) -> String + Send + 'static,
) -> Browser {
    Box::new(move |url: &str| {
        let query = url.split_once('?').unwrap().1;
        let params: HashMap<String, String> = query
            .split('&')
            .map(|pair| {
                let (key, value) = pair.split_once('=').unwrap();
                (key.to_owned(), decode_component(value).unwrap())
            })
            .collect();
        *mock.nonce.lock().unwrap() = params.get("nonce").cloned();
        *mock.challenge.lock().unwrap() = params.get("code_challenge").cloned();
        mock.event(format!("open {}", url.split('?').next().unwrap()));
        let target = callback(&params);
        let redirect = params["redirect_uri"].clone();
        std::thread::spawn(move || {
            assert!(http_get(&redirect, "/favicon.ico").starts_with("HTTP/1.1 404"));
            assert!(http_get(&redirect, &target).starts_with("HTTP/1.1 200"));
        });
        Ok(())
    })
}

fn approve(params: &HashMap<String, String>) -> String {
    format!(
        "/auth/callback?code=code-SECRET-xxxxxxxx&state={}&client_id={ISSUED_CLIENT}&scope={}",
        encode_component(&params["state"]),
        encode_component(PLAN_SCOPES)
    )
}

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

fn connect_with(h: &Harness, open: Browser) -> Result<Status, Failure> {
    let connection = h.connection.clone();
    run(async move { connection.connect(open, Duration::from_secs(10)).await })
}

fn connect(h: &Harness) -> Result<Status, Failure> {
    connect_with(h, browser(h.mock.clone(), approve))
}

// ---------------------------------------------------------------------------
// Protocol

#[test]
fn authorize_url_registers_first_and_reuses_the_issued_client_after() {
    let redirect = "http://127.0.0.1:5000/auth/callback".to_owned();
    let first = Attempt::new(None, HOST, redirect.clone()).unwrap();
    let url = first.authorize_url("https://auth.openai.com/api/accounts/authorize");
    assert!(url.starts_with(
        "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&"
    ));
    let query = url.split_once('?').unwrap().1;
    let value = |name: &str| query_value(query, name);
    assert_eq!(value("agent_name_hint").as_deref(), Some("Cadence"));
    assert_eq!(value("ext_agent_host_id").as_deref(), Some(HOST));
    assert_eq!(value("redirect_uri"), Some(redirect.clone()));
    assert_eq!(value("scope").as_deref(), Some(SCOPES));
    assert!(url.contains("scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct"));
    assert_eq!(
        value("resource").as_deref(),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(value("response_type").as_deref(), Some("code"));
    assert_eq!(value("code_challenge_method").as_deref(), Some("S256"));
    assert_eq!(
        value("code_challenge"),
        Some(pkce_challenge(&first.verifier))
    );
    assert_eq!(value("state"), Some(first.state.clone()));
    assert_eq!(value("nonce"), Some(first.nonce.clone()));

    let returning = Attempt::new(Some(ISSUED_CLIENT), HOST, redirect).unwrap();
    let url = returning.authorize_url("https://auth.openai.com/api/accounts/authorize");
    assert_eq!(
        query_value(url.split_once('?').unwrap().1, "client_id").as_deref(),
        Some(ISSUED_CLIENT)
    );
    assert!(!url.contains("agent_name_hint"));
    assert_ne!(first.state, returning.state);
    assert_ne!(first.nonce, returning.nonce);
    assert_ne!(first.verifier, returning.verifier);
}

#[test]
fn host_ids_are_random_uuid_urns() {
    let one = new_host_id().unwrap();
    assert!(is_host_id(&one));
    assert_eq!(&one[23..24], "4");
    assert_ne!(one, new_host_id().unwrap());
    assert!(!is_host_id("urn:uuid:not-a-uuid"));
    assert!(!is_host_id("00000000-0000-4000-8000-000000000000"));
}

#[test]
fn callback_checks_state_before_anything_else() {
    let redirect = "http://127.0.0.1:1/auth/callback".to_owned();
    let attempt = Attempt::new(None, HOST, redirect.clone()).unwrap();
    let check = |query: String, attempt: &Attempt| {
        accept_callback(&CallbackParams::from_query(&query), attempt)
            .map(|accepted| (accepted.code, accepted.client_id))
    };
    let state = encode_component(&attempt.state);
    assert_eq!(
        check(
            format!("code=c&state=wrong&client_id={ISSUED_CLIENT}"),
            &attempt
        )
        .err(),
        Some(Failure::Callback)
    );
    assert_eq!(
        check("error=access_denied&state=wrong".into(), &attempt).err(),
        Some(Failure::Callback)
    );
    assert_eq!(
        check(format!("error=access_denied&state={state}"), &attempt).err(),
        Some(Failure::Denied)
    );
    assert_eq!(
        check(format!("error=server_error&state={state}"), &attempt).err(),
        Some(Failure::Callback)
    );
    assert_eq!(
        check(format!("state={state}&client_id={ISSUED_CLIENT}"), &attempt).err(),
        Some(Failure::Callback)
    );
    assert_eq!(
        check(format!("code=c&state={state}"), &attempt).err(),
        Some(Failure::Registration)
    );
    assert_eq!(
        check(
            format!("code=c&state={state}&client_id={DYNAMIC_CLIENT_ID}"),
            &attempt
        )
        .err(),
        Some(Failure::Registration)
    );
    assert_eq!(
        check(
            format!("code=c&state={state}&client_id={ISSUED_CLIENT}"),
            &attempt
        )
        .unwrap(),
        ("c".to_owned(), ISSUED_CLIENT.to_owned())
    );
    let returning = Attempt::new(Some(ISSUED_CLIENT), HOST, redirect).unwrap();
    let state = encode_component(&returning.state);
    assert_eq!(
        check(
            format!("code=c&state={state}&client_id=oaiapp_other"),
            &returning
        )
        .err(),
        Some(Failure::Callback)
    );
    assert!(check(format!("code=c&state={state}"), &returning).is_ok());
}

#[test]
fn id_token_is_rs256_from_the_jwks_with_issuer_audience_nonce_and_expiry() {
    let keys = jwks();
    let check = |token: &str| {
        verify_id_token(token, keys.as_bytes(), ISSUED_CLIENT, "nonce-1", NOW)
            .map(|claims| (claims.subject, claims.email))
    };
    assert_eq!(
        check(&id_token("nonce-1")).unwrap(),
        (
            "user-subject".to_owned(),
            Some("person@example.test".to_owned())
        )
    );
    let header = json!({"alg":"RS256","kid":"test-key"});
    let with = |key: &str, value: Value| {
        let mut changed = claims("nonce-1");
        changed[key] = value;
        sign(header.clone(), changed)
    };
    assert!(check(&with("iss", json!("https://evil.example"))).is_err());
    assert!(check(&with("aud", json!("oaiapp_other"))).is_err());
    assert!(check(&with("aud", json!([ISSUED_CLIENT, "other"]))).is_err());
    assert!(check(&with("exp", json!(NOW - 120))).is_err());
    assert!(check(&with("iat", json!(NOW + 600))).is_err());
    assert!(check(&with("nonce", json!("nonce-2"))).is_err());
    assert!(check(&with("sub", json!(""))).is_err());
    assert!(check(&sign(
        json!({"alg":"RS256","kid":"other-key"}),
        claims("nonce-1")
    ))
    .is_err());
    assert!(check(&sign(
        json!({"alg":"HS256","kid":"test-key"}),
        claims("nonce-1")
    ))
    .is_err());
    let token = id_token("nonce-1");
    let (signed, signature) = token.rsplit_once('.').unwrap();
    let other = id_token("nonce-2");
    let other_signature = other.rsplit_once('.').unwrap().1;
    assert!(check(&format!("{signed}.{other_signature}")).is_err());
    assert!(check(&format!("{signed}.")).is_err());
    assert!(check(&format!("{signed}.{signature}x")).is_err());
    assert!(check("not.a.jwt").is_err());
}

#[test]
fn discovery_must_come_from_the_issuer_with_a_revocation_endpoint() {
    assert!(parse_discovery(discovery().as_bytes()).is_ok());
    for (key, value) in [
        ("revocation_endpoint", Value::Null),
        (
            "token_endpoint",
            json!("https://auth.openai.com.evil.example/token"),
        ),
        ("jwks_uri", json!("https://evil.example/jwks.json")),
        ("issuer", json!("https://evil.example")),
    ] {
        let mut document: Value = serde_json::from_str(&discovery()).unwrap();
        document[key] = value;
        assert!(
            parse_discovery(document.to_string().as_bytes()).is_err(),
            "{key}"
        );
    }
}

#[test]
fn catalog_rows_keep_slug_and_visibility() {
    let rows = parse_catalog(
        br#"{"data":[{"id":"a","visibility":"list"},{"slug":"b"},{"visibility":"list"}]}"#,
    )
    .unwrap();
    assert_eq!(
        rows,
        vec![
            CatalogModel {
                slug: "a".into(),
                visibility: Some("list".into())
            },
            CatalogModel {
                slug: "b".into(),
                visibility: None
            },
        ]
    );
    assert!(parse_catalog(b"[]").is_err());
}

// ---------------------------------------------------------------------------
// Loopback

#[test]
fn loopback_ignores_other_paths_then_closes_after_one_callback() {
    let loopback = Loopback::bind().unwrap();
    let redirect = loopback.redirect_uri();
    assert!(redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/auth/callback"));
    assert_ne!(address(&redirect), "127.0.0.1:0");
    let client = redirect.clone();
    let thread = std::thread::spawn(move || {
        assert!(http_get(&client, "/other?state=x").starts_with("HTTP/1.1 404"));
        let page = http_get(&client, "/auth/callback?code=abc&state=s%20t");
        assert!(page.starts_with("HTTP/1.1 200") && !page.contains("abc"));
    });
    let params = loopback
        .wait(Duration::from_secs(10), &AtomicBool::new(false))
        .unwrap();
    thread.join().unwrap();
    assert_eq!(params.code.as_deref(), Some("abc"));
    assert_eq!(params.state.as_deref(), Some("s t"));
    assert!(std::net::TcpStream::connect(address(&redirect)).is_err());
}

#[test]
fn loopback_times_out_and_cancels() {
    let started = std::time::Instant::now();
    assert_eq!(
        Loopback::bind()
            .unwrap()
            .wait(Duration::from_millis(200), &AtomicBool::new(false))
            .err(),
        Some(Failure::TimedOut)
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(
        Loopback::bind()
            .unwrap()
            .wait(Duration::from_secs(60), &AtomicBool::new(true))
            .err(),
        Some(Failure::Cancelled)
    );
    assert_eq!(CALLBACK_TIMEOUT, Duration::from_secs(300));
}

// ---------------------------------------------------------------------------
// Connection

#[test]
fn connect_registers_validates_and_keeps_tokens_only_in_keychain_items() {
    let h = harness();
    *h.mock.token_scope.lock().unwrap() = Some(PLAN_SCOPES.into());
    assert_eq!(
        h.connection.status().unwrap(),
        Status {
            state: ConnectionState::Disconnected,
            email: None
        }
    );
    assert_eq!(
        connect(&h).unwrap(),
        Status {
            state: ConnectionState::ConnectedWithPlanUsage,
            email: Some("person@example.test".into())
        }
    );
    let installation: Value =
        serde_json::from_str(&h.mock.secrets.lock().unwrap()[INSTALLATION_ITEM]).unwrap();
    let host_id = installation["host_id"].as_str().unwrap().to_owned();
    assert!(is_host_id(&host_id));
    assert_eq!(installation["client_id"], ISSUED_CLIENT);
    let session = h.mock.session().unwrap();
    assert_eq!(session["refresh_token"], "rt-SECRET-refresh-1-xxxxxxxx");
    assert_eq!(session["expires_at"], NOW + 3599);
    let mut names: Vec<String> = h.mock.secrets.lock().unwrap().keys().cloned().collect();
    names.sort();
    assert_eq!(
        names,
        vec![INSTALLATION_ITEM.to_owned(), SESSION_ITEM.to_owned()]
    );
    let events = h.mock.events();
    let position = |needle: &str| {
        events
            .iter()
            .position(|event| event.starts_with(needle))
            .unwrap()
    };
    assert!(
        position(&format!("GET {DISCOVERY_URL}"))
            < position("open https://auth.openai.com/api/accounts/authorize")
    );
    assert!(position("POST token authorization_code") < position(&format!("GET {JWKS_URL}")));
    assert!(position(&format!("GET {JWKS_URL}")) < position("keychain set chatgpt-session"));

    // A returning sign-in reuses the host ID and the issued client ID, and revokes
    // the replaced refresh token.
    let open = browser(h.mock.clone(), move |params| {
        assert_eq!(params["client_id"], ISSUED_CLIENT);
        assert_eq!(params["ext_agent_host_id"], host_id);
        assert!(!params.contains_key("agent_name_hint"));
        format!(
            "/auth/callback?code=c2&state={}",
            encode_component(&params["state"])
        )
    });
    connect_with(&h, open).unwrap();
    assert!(h
        .mock
        .events()
        .contains(&"POST revoke rt-SECRET-refresh-1-xxxxxxxx".to_owned()));
    assert_eq!(
        h.mock.session().unwrap()["refresh_token"],
        "rt-SECRET-refresh-2-xxxxxxxx"
    );
}

#[test]
fn the_callback_scope_decides_plan_usage_when_the_token_response_has_none() {
    let h = harness();
    assert_eq!(
        connect(&h).unwrap().state,
        ConnectionState::ConnectedWithPlanUsage
    );
    let h = harness();
    *h.mock.token_scope.lock().unwrap() = Some("openid profile email offline_access".into());
    assert_eq!(
        connect(&h).unwrap().state,
        ConnectionState::ConnectedWithoutPlanUsage
    );
}

#[test]
fn an_unverifiable_id_token_is_revoked_and_never_saved() {
    let h = harness();
    h.mock.bad_nonce.store(true, Ordering::SeqCst);
    assert_eq!(connect(&h).err(), Some(Failure::IdToken));
    assert!(h.mock.session().is_none());
    assert!(h
        .mock
        .events()
        .contains(&"POST revoke rt-SECRET-refresh-1-xxxxxxxx".to_owned()));
    assert_eq!(
        h.connection.status().unwrap().state,
        ConnectionState::Disconnected
    );
}

#[test]
fn a_wrong_state_callback_fails_and_saves_nothing() {
    let h = harness();
    let open = browser(h.mock.clone(), |_| {
        format!("/auth/callback?code=c&state=forged&client_id={ISSUED_CLIENT}")
    });
    assert_eq!(connect_with(&h, open).err(), Some(Failure::Callback));
    assert!(h.mock.session().is_none());
    assert!(!h
        .mock
        .events()
        .iter()
        .any(|event| event.starts_with("POST token")));
}

#[test]
fn concurrent_callers_share_one_refresh_and_the_rotated_token_is_saved() {
    let h = harness();
    connect(&h).unwrap();
    h.clock.store(NOW + 3599 - 60, Ordering::SeqCst);
    let (one, two) = (h.connection.clone(), h.connection.clone());
    let (first, second) = run(async move {
        let a = tauri::async_runtime::spawn(async move { one.access_token(None).await });
        let b = tauri::async_runtime::spawn(async move { two.access_token(None).await });
        (a.await.unwrap(), b.await.unwrap())
    });
    assert_eq!(h.mock.refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(first.unwrap(), "at-SECRET-access-2-xxxxxxxx");
    assert_eq!(second.unwrap(), "at-SECRET-access-2-xxxxxxxx");
    let session = h.mock.session().unwrap();
    assert_eq!(session["refresh_token"], "rt-SECRET-refresh-2-xxxxxxxx");
    assert_eq!(session["expires_at"], NOW + 3599 - 60 + 3599);
    assert!(h
        .mock
        .events()
        .contains(&"POST token refresh_token rt-SECRET-refresh-1-xxxxxxxx".to_owned()));
}

#[test]
fn a_rejected_refresh_means_reconnect_without_leaking_the_token() {
    let h = harness();
    connect(&h).unwrap();
    h.clock.store(NOW + 4000, Ordering::SeqCst);
    h.mock.refresh_statuses.lock().unwrap().push_back(400);
    let error = run(h.connection.models()).err().unwrap();
    assert_eq!(error, Failure::NeedsReconnect);
    assert!(!error.message().contains("SECRET"));
    assert_eq!(
        h.connection.status().unwrap(),
        Status {
            state: ConnectionState::NeedsReconnect,
            email: Some("person@example.test".into())
        }
    );
    let session = h.mock.session().unwrap();
    assert!(session["refresh_token"].is_null() && session["access_token"].is_null());
    assert_eq!(
        run(h.connection.models()).err(),
        Some(Failure::NeedsReconnect)
    );
    assert_eq!(h.mock.refreshes.load(Ordering::SeqCst), 1);
}

#[test]
fn a_server_error_on_refresh_keeps_the_connection() {
    let h = harness();
    connect(&h).unwrap();
    h.clock.store(NOW + 4000, Ordering::SeqCst);
    h.mock.refresh_statuses.lock().unwrap().push_back(503);
    assert_eq!(run(h.connection.models()).err(), Some(Failure::Unavailable));
    assert_eq!(
        h.mock.session().unwrap()["refresh_token"],
        "rt-SECRET-refresh-1-xxxxxxxx"
    );
    assert_eq!(
        h.connection.status().unwrap().state,
        ConnectionState::ConnectedWithPlanUsage
    );
}

#[test]
fn the_catalog_lists_slug_and_visibility_and_retries_once_after_a_401() {
    let h = harness();
    connect(&h).unwrap();
    let models = run(h.connection.models()).unwrap();
    assert_eq!(
        models
            .iter()
            .map(|model| (model.slug.as_str(), model.visibility.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("gpt-5.5-mini", Some("list")),
            ("gpt-hidden", Some("hide")),
            ("gpt-plain", None)
        ]
    );
    assert_eq!(
        serde_json::to_value(&models[0]).unwrap(),
        json!({"slug":"gpt-5.5-mini","visibility":"list"})
    );
    assert_eq!(h.mock.refreshes.load(Ordering::SeqCst), 0);
    h.mock.catalog_statuses.lock().unwrap().extend([401, 200]);
    assert_eq!(run(h.connection.models()).unwrap().len(), 3);
    assert_eq!(h.mock.refreshes.load(Ordering::SeqCst), 1);
    h.mock.catalog_statuses.lock().unwrap().extend([401, 401]);
    assert_eq!(
        run(h.connection.models()).err(),
        Some(Failure::NeedsReconnect)
    );
    assert_eq!(
        h.connection.status().unwrap().state,
        ConnectionState::NeedsReconnect
    );
}

#[test]
fn disconnect_revokes_at_openai_before_clearing_local_tokens() {
    let h = harness();
    connect(&h).unwrap();
    assert_eq!(
        run(h.connection.disconnect()).unwrap().outcome,
        DisconnectOutcome::Revoked
    );
    let events = h.mock.events();
    let revoke = events
        .iter()
        .position(|event| event == "POST revoke rt-SECRET-refresh-1-xxxxxxxx")
        .unwrap();
    let clear = events
        .iter()
        .position(|event| event == "keychain remove chatgpt-session")
        .unwrap();
    assert!(revoke < clear);
    assert!(h.mock.session().is_none());
    // The installation record outlives the account connection.
    assert!(h
        .mock
        .secrets
        .lock()
        .unwrap()
        .contains_key(INSTALLATION_ITEM));
    assert_eq!(
        h.connection.status().unwrap().state,
        ConnectionState::Disconnected
    );
    assert_eq!(
        run(h.connection.disconnect()).unwrap().outcome,
        DisconnectOutcome::NotConnected
    );
    assert_eq!(
        run(h.connection.models()).err(),
        Some(Failure::Disconnected)
    );
}

#[test]
fn disconnect_retries_server_errors_and_clears_tokens_even_when_revocation_fails() {
    let h = harness();
    connect(&h).unwrap();
    h.mock
        .revoke_replies
        .lock()
        .unwrap()
        .extend([Some(503), None, Some(200)]);
    assert_eq!(
        run(h.connection.disconnect()).unwrap().outcome,
        DisconnectOutcome::Revoked
    );
    connect(&h).unwrap();
    h.mock
        .revoke_replies
        .lock()
        .unwrap()
        .extend([Some(503), Some(503), Some(503)]);
    assert_eq!(
        run(h.connection.disconnect()).unwrap().outcome,
        DisconnectOutcome::RevocationFailed
    );
    assert!(h.mock.session().is_none());
    connect(&h).unwrap();
    h.mock.revoke_replies.lock().unwrap().push_back(Some(400));
    assert_eq!(
        run(h.connection.disconnect()).unwrap().outcome,
        DisconnectOutcome::RevocationFailed
    );
    assert_eq!(
        h.mock
            .events()
            .iter()
            .filter(|event| event.starts_with("POST revoke"))
            .count(),
        3 + 3 + 1
    );
}

#[test]
fn a_second_sign_in_while_one_is_waiting_is_refused_and_cancel_stops_the_wait() {
    let h = harness();
    let connection = h.connection.clone();
    let canceller = h.connection.clone();
    let (second, first) = run(async move {
        let waiting = tauri::async_runtime::spawn(async move {
            connection
                .connect(|_| Ok(()), Duration::from_secs(30))
                .await
        });
        while canceller.pending.lock().unwrap().is_none() {
            let _ = tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(Duration::from_millis(10))
            })
            .await;
        }
        let second = canceller.connect(|_| Ok(()), Duration::from_secs(1)).await;
        canceller.cancel_connect();
        (second, waiting.await.unwrap())
    });
    assert_eq!(second.err(), Some(Failure::AlreadyConnecting));
    assert_eq!(first.err(), Some(Failure::Cancelled));
    assert!(h.connection.pending.lock().unwrap().is_none());
    assert!(h.mock.session().is_none());
}

#[test]
fn exports_backups_and_the_database_hold_no_chatgpt_credential() {
    let h = harness();
    *h.mock.token_scope.lock().unwrap() = Some(PLAN_SCOPES.into());
    let directory =
        std::env::temp_dir().join(format!("cadence-chatgpt-secrets-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let live = directory.join("cadence.sqlite3");
    let store = crate::local_store::open(&live).unwrap();

    connect(&h).unwrap();
    h.clock.store(NOW + 4000, Ordering::SeqCst);
    run(h.connection.models()).unwrap(); // rotates the refresh token once
    assert_eq!(
        h.mock.session().unwrap()["refresh_token"],
        "rt-SECRET-refresh-2-xxxxxxxx"
    );

    let export = {
        let mut db = store.0.lock().unwrap();
        let profile = crate::local_store::execute(
            &mut db,
            serde_json::from_value(json!({"operation":"readProfile"})).unwrap(),
        )
        .unwrap();
        crate::local_store::execute(
            &mut db,
            serde_json::from_value(json!({"operation":"readExportSnapshot",
                "profileId":profile["id"],"startLocalDate":null,"endLocalDate":"2026-11-12",
                "includeTimeTracking":true,"throughStartedAt":"2026-11-12T00:00:00Z"}))
            .unwrap(),
        )
        .unwrap()
        .to_string()
    };
    let backup = directory.join("backup.sqlite3");
    crate::local_store::backup_database(&store, &live, &backup).unwrap();
    let protected = crate::local_store::protected_backup_database(&store, &live).unwrap();

    let mut haystacks = vec![("export".to_owned(), export.into_bytes())];
    for path in [
        backup,
        protected,
        live.clone(),
        live.with_extension("sqlite3-wal"),
    ] {
        if let Ok(bytes) = std::fs::read(&path) {
            haystacks.push((path.display().to_string(), bytes));
        }
    }
    assert!(haystacks.len() >= 4);
    let secrets = h.mock.secret_values();
    assert_eq!(secrets.len(), 3);
    for (name, bytes) in &haystacks {
        let text = String::from_utf8_lossy(bytes);
        for secret in &secrets {
            assert!(
                !text.contains(secret.as_str()),
                "{name} holds a ChatGPT value"
            );
        }
        assert!(
            !text.to_lowercase().contains("chatgpt"),
            "{name} mentions ChatGPT"
        );
    }
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn nothing_logs_and_token_records_have_no_debug_output() {
    for source in [
        include_str!("mod.rs"),
        include_str!("protocol.rs"),
        include_str!("loopback.rs"),
        include_str!("transport.rs"),
    ] {
        for forbidden in ["println!", "eprintln!", "dbg!", "log::", "tracing::"] {
            assert!(!source.contains(forbidden), "{forbidden}");
        }
    }
    let source = include_str!("mod.rs");
    for record in ["struct Installation", "struct Session"] {
        let before = &source[..source.find(record).unwrap()];
        let derive = before.rsplit("#[derive(").next().unwrap();
        assert!(derive.starts_with("Serialize, Deserialize)]"), "{record}");
    }
    let protocol = include_str!("protocol.rs");
    for record in [
        "pub struct TokenSet",
        "pub struct Attempt",
        "pub struct CallbackParams",
    ] {
        let before = &protocol[..protocol.find(record).unwrap()];
        assert!(
            !before
                .rsplit('\n')
                .nth(1)
                .unwrap_or_default()
                .contains("Debug"),
            "{record}"
        );
    }
    assert_eq!(
        serde_json::to_string(&Status {
            state: ConnectionState::ConnectedWithPlanUsage,
            email: None
        })
        .unwrap(),
        r#"{"state":"connectedWithPlanUsage","email":null}"#
    );
}
