//! HTTPS and Keychain boundaries for the ChatGPT connection. Tests replace both.

use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

const MAX_BODY: usize = 2 * 1024 * 1024;

pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Any transport failure. It carries no detail, so no URL, header or body can leak.
pub struct NetworkError;

pub trait Http: Send + Sync {
    fn get(
        &self,
        url: &str,
        bearer: Option<&str>,
    ) -> impl Future<Output = Result<Reply, NetworkError>> + Send;
    fn post_form(
        &self,
        url: &str,
        body: String,
    ) -> impl Future<Output = Result<Reply, NetworkError>> + Send;
}

pub trait Secrets: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, ()>;
    fn set(&self, name: &str, value: String) -> Result<(), ()>;
    fn remove(&self, name: &str) -> Result<(), ()>;
}

/// The app's Keychain items, through the native-only slots in `auth.rs`.
pub struct Keychain;

impl Secrets for Keychain {
    fn get(&self, name: &str) -> Result<Option<String>, ()> {
        crate::auth::native_secret_get(name).map_err(|_| ())
    }
    fn set(&self, name: &str, value: String) -> Result<(), ()> {
        crate::auth::native_secret_set(name, value).map_err(|_| ())
    }
    fn remove(&self, name: &str) -> Result<(), ()> {
        crate::auth::native_secret_remove(name).map_err(|_| ())
    }
}

/// HTTPS only, no redirects, no cookies, 30-second timeout. The client is built on
/// first use, so app launch never depends on it.
#[derive(Default)]
pub struct Https(OnceLock<Option<reqwest::Client>>);

impl Https {
    fn client(&self) -> Result<&reqwest::Client, NetworkError> {
        self.0
            .get_or_init(|| {
                // Same provider choice as tauri-plugin-updater, which shares this rustls build.
                if rustls::crypto::CryptoProvider::get_default().is_none() {
                    let _ = rustls::crypto::ring::default_provider().install_default();
                }
                reqwest::Client::builder()
                    .https_only(true)
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(30))
                    .user_agent("Cadence for Mac")
                    .build()
                    .ok()
            })
            .as_ref()
            .ok_or(NetworkError)
    }
}

async fn read(response: reqwest::Response) -> Result<Reply, NetworkError> {
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_BODY)
    {
        return Err(NetworkError);
    }
    let body = response.bytes().await.map_err(|_| NetworkError)?;
    if body.len() > MAX_BODY {
        return Err(NetworkError);
    }
    Ok(Reply {
        status,
        body: body.to_vec(),
    })
}

impl Http for Https {
    async fn get(&self, url: &str, bearer: Option<&str>) -> Result<Reply, NetworkError> {
        let mut request = self
            .client()?
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json");
        if let Some(token) = bearer {
            request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
        }
        read(request.send().await.map_err(|_| NetworkError)?).await
    }

    async fn post_form(&self, url: &str, body: String) -> Result<Reply, NetworkError> {
        let response = self
            .client()?
            .post(url)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .header(reqwest::header::ACCEPT, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|_| NetworkError)?;
        read(response).await
    }
}
