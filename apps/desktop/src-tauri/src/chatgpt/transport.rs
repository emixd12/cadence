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

async fn read(mut response: reqwest::Response) -> Result<Reply, NetworkError> {
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err(NetworkError);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| NetworkError)? {
        if chunk.len() > MAX_BODY - body.len() {
            return Err(NetworkError);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Reply { status, body })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn a_chunked_body_is_rejected_before_the_server_finishes_it() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (finished, wait) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 1024];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                .unwrap();
            let chunk = vec![b'x'; 64 * 1024];
            for _ in 0..=MAX_BODY / chunk.len() {
                let sent = write!(stream, "{:x}\r\n", chunk.len())
                    .and_then(|_| stream.write_all(&chunk))
                    .and_then(|_| stream.write_all(b"\r\n"));
                if sent.is_err() {
                    break;
                }
            }
            // Keep the response open. A whole-body reader cannot return yet.
            let rejected = wait.recv_timeout(Duration::from_secs(5)).unwrap_or(false);
            let _ = stream.write_all(b"0\r\n\r\n");
            assert!(rejected, "the reader waited for the oversized response to finish");
        });
        let result = tauri::async_runtime::block_on(async {
            // HTTP is only used by this local fixture; production Https stays HTTPS-only.
            if rustls::crypto::CryptoProvider::get_default().is_none() {
                let _ = rustls::crypto::ring::default_provider().install_default();
            }
            let response = reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap()
                .get(format!("http://{address}"))
                .send()
                .await
                .unwrap();
            read(response).await
        });
        let _ = finished.send(result.is_err());
        server.join().unwrap();
        assert!(result.is_err());
    }
}
