use reqwest::blocking::Client;
use std::time::Duration;
use url::Url;
use zmanager_tzap_hosted::auth_client::{TzapAuthError, TzapAuthHttpMethod, TzapAuthHttpRequest, TzapAuthHttpResponse, TzapAuthHttpTransport};

const DESKTOP_USER_AGENT: &str = concat!("ZManager-Desktop/", env!("CARGO_PKG_VERSION"));

pub fn ensure_hosted_request_url(base_url: &str) -> Result<(), String> {
    if option_env!("ZMANAGER_TZAP_BUILD_ENV") != Some("staging") {
        return Ok(());
    }

    let requested = Url::parse(base_url).map_err(|_| "Hosted service URL was invalid".to_owned())?;
    let expected = Url::parse(crate::constants::TZAP_SERVER_BASE_URL).map_err(|_| "Compiled hosted service URL was invalid".to_owned())?;
    let same_origin =
        requested.scheme() == expected.scheme() && requested.host() == expected.host() && requested.port_or_known_default() == expected.port_or_known_default();
    if same_origin { Ok(()) } else { Err("Hosted request was blocked because its origin does not match the compiled staging server".to_owned()) }
}

pub struct HostedHttpTransport {
    client: Client,
}

impl HostedHttpTransport {
    pub fn new() -> Result<Self, String> {
        // The desktop crate uses reqwest/rustls for both hosted HTTPS and
        // LocalSend. Install the explicit provider before any client is built;
        // the reqwest `rustls-no-provider` feature intentionally leaves this
        // application-level choice to the caller.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = Client::builder()
            .user_agent(DESKTOP_USER_AGENT)
            .timeout(Duration::from_secs(3))
            .connect_timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        Ok(Self { client })
    }
}

impl TzapAuthHttpTransport for HostedHttpTransport {
    fn send(&self, request: &TzapAuthHttpRequest) -> Result<TzapAuthHttpResponse, TzapAuthError> {
        ensure_hosted_request_url(&request.url).map_err(|message| TzapAuthError::Transport { message })?;
        let method = match request.method {
            TzapAuthHttpMethod::Get => reqwest::Method::GET,
            TzapAuthHttpMethod::Post => reqwest::Method::POST,
            TzapAuthHttpMethod::Put => reqwest::Method::PUT,
            TzapAuthHttpMethod::Delete => reqwest::Method::DELETE,
        };

        let mut req = self.client.request(method, &request.url);

        for (name, value) in &request.headers {
            req = req.header(name, value);
        }

        if let Some(token) = &request.bearer_token {
            req = req.bearer_auth(token.expose());
        }

        if let Some(body) = &request.body {
            req = req.json(body);
        }

        let response = req.send().map_err(|e| TzapAuthError::Transport { message: format!("HTTP request failed: {}", e) })?;

        let status_code = response.status().as_u16();
        let mut headers = Vec::new();
        for (name, value) in response.headers() {
            if let Ok(value_str) = value.to_str() {
                headers.push((name.as_str().to_owned(), value_str.to_owned()));
            }
        }
        let body = response.bytes().map_err(|e| TzapAuthError::Transport { message: format!("Failed to read HTTP response body: {}", e) })?.to_vec();

        Ok(TzapAuthHttpResponse { status_code, headers, body })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use zmanager_tzap_hosted::auth_client::{TzapAuthHttpMethod, TzapAuthRequestOptions};

    #[test]
    fn hosted_transport_identifies_the_desktop_client() {
        if option_env!("ZMANAGER_TZAP_BUILD_ENV") == Some("staging") {
            // The staging guard intentionally rejects the local test server;
            // the origin guard itself is covered by the test below.
            return;
        }
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let address = listener.local_addr().expect("test listener should expose an address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test request should connect");
            let mut request = [0_u8; 4096];
            let bytes_read = stream.read(&mut request).expect("test request should be readable");
            let request = String::from_utf8_lossy(&request[..bytes_read]);
            assert!(request.lines().any(|line| line.eq_ignore_ascii_case(&format!("user-agent: {DESKTOP_USER_AGENT}"))));
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").expect("test response should be writable");
        });

        let transport = HostedHttpTransport::new().expect("desktop transport should initialize");
        let response = transport
            .send(&TzapAuthHttpRequest {
                method: TzapAuthHttpMethod::Get,
                url: format!("http://{address}/health"),
                bearer_token: None,
                body: None,
                options: TzapAuthRequestOptions::default(),
                headers: Vec::new(),
            })
            .expect("test request should succeed");
        assert_eq!(response.status_code, 200);
        server.join().expect("test server should finish");
    }

    #[test]
    fn non_staging_builds_do_not_reject_local_transport_tests() {
        if option_env!("ZMANAGER_TZAP_BUILD_ENV") != Some("staging") {
            assert!(ensure_hosted_request_url("http://127.0.0.1:8787").is_ok());
        }
    }

    #[test]
    fn staging_builds_reject_origins_that_are_not_compiled_into_the_artifact() {
        if option_env!("ZMANAGER_TZAP_BUILD_ENV") == Some("staging") {
            assert!(ensure_hosted_request_url(crate::constants::TZAP_SERVER_BASE_URL).is_ok());
            assert!(ensure_hosted_request_url("https://sign.tzap.org").is_err());
        }
    }
}
