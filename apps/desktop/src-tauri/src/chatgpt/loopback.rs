//! One-shot loopback listener for the ChatGPT sign-in callback.
//!
//! Binds 127.0.0.1 on an OS-chosen port and serves only `GET /auth/callback`.
//! The listener closes after the first callback, on timeout, or on cancel. Other
//! requests (a browser's favicon fetch, for example) get 404 and the wait goes on.
//! The callback page is static and reflects nothing from the request.

use super::protocol::{CallbackParams, Failure, CALLBACK_PATH};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_REQUEST_HEAD: usize = 16 * 1024;

const DONE_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Cadence</title><p>You can close this tab and return to Cadence.</p>";

pub struct Loopback {
    listener: TcpListener,
    port: u16,
}

impl Loopback {
    pub fn bind() -> Result<Self, Failure> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| Failure::Unavailable)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| Failure::Unavailable)?;
        let port = listener
            .local_addr()
            .map_err(|_| Failure::Unavailable)?
            .port();
        Ok(Loopback { listener, port })
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{CALLBACK_PATH}", self.port)
    }

    /// Blocks until one callback arrives, the deadline passes or `cancel` is set.
    /// Consumes the listener, so its socket closes on every return path.
    pub fn wait(self, timeout: Duration, cancel: &AtomicBool) -> Result<CallbackParams, Failure> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(Failure::Cancelled);
            }
            if Instant::now() >= deadline {
                return Err(Failure::TimedOut);
            }
            match self.listener.accept() {
                Ok((stream, peer)) if peer.ip().is_loopback() => {
                    if let Some(params) = serve(stream) {
                        return Ok(params);
                    }
                }
                Ok(_) => {}
                Err(_) => std::thread::sleep(Duration::from_millis(25)),
            }
        }
    }
}

/// Returns the callback parameters for `GET /auth/callback`; answers 404 otherwise.
fn serve(mut stream: TcpStream) -> Option<CallbackParams> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut head = Vec::new();
    let mut buffer = [0u8; 2048];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") && head.len() < MAX_REQUEST_HEAD {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => head.extend_from_slice(&buffer[..read]),
        }
    }
    let text = String::from_utf8_lossy(&head);
    let mut request_line = text.lines().next().unwrap_or_default().split(' ');
    let (method, target) = (request_line.next(), request_line.next());
    let (path, query) = target
        .unwrap_or_default()
        .split_once('?')
        .unwrap_or((target.unwrap_or_default(), ""));
    if method != Some("GET") || path != CALLBACK_PATH {
        respond(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "Not found",
        );
        return None;
    }
    respond(&mut stream, "200 OK", "text/html; charset=utf-8", DONE_PAGE);
    Some(CallbackParams::from_query(query))
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
