use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use std::io::Write;
use chrono::Local;
use tauri::Manager;

// ------------------- helpers -------------------

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let d = dir.join("data");
    if !d.exists() {
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    }
    let b = d.join("backups");
    if !b.exists() {
        fs::create_dir_all(&b).map_err(|e| e.to_string())?;
    }
    Ok(d)
}

fn resolve_path(app: &tauri::AppHandle, rel_or_abs: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(rel_or_abs);
    if p.is_absolute() {
        return Ok(p);
    }
    let base = data_dir(app)?;
    Ok(base.join(rel_or_abs))
}

fn backup_before_write(app: &tauri::AppHandle, target: &PathBuf) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    let base = data_dir(app)?;
    let name = target.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let backup = base.join("backups").join(format!("{name}.{stamp}.bak"));
    fs::copy(target, backup).map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------- commands -------------------

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let d = data_dir(&app)?;
    Ok(d.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = resolve_path(&app, &path)?;
    fs::read_to_string(&p).map_err(|e| format!("read {}: {}", p.display(), e))
}

#[tauri::command]
fn write_text_file(app: tauri::AppHandle, path: String, contents: String, backup: Option<bool>) -> Result<(), String> {
    let p = resolve_path(&app, &path)?;
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    if backup.unwrap_or(true) {
        backup_before_write(&app, &p).ok();
    }
    let mut f = fs::File::create(&p).map_err(|e| format!("open {}: {}", p.display(), e))?;
    f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn file_exists(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let p = resolve_path(&app, &path)?;
    Ok(p.exists())
}

#[tauri::command]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let base = data_dir(&app)?;
    let b = base.join("backups");
    if !b.exists() { return Ok(vec![]); }
    let mut out = vec![];
    for entry in fs::read_dir(&b).map_err(|e| e.to_string())? {
        if let Ok(e) = entry {
            out.push(e.file_name().to_string_lossy().to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn copy_into_data(app: tauri::AppHandle, src: String, dest_name: String) -> Result<String, String> {
    let base = data_dir(&app)?;
    let dest = base.join(&dest_name);
    fs::copy(&src, &dest).map_err(|e| format!("copy {} -> {}: {}", src, dest.display(), e))?;
    Ok(dest.to_string_lossy().to_string())
}

// ------------------- Grok proxy -------------------

#[derive(Deserialize)]
struct GrokRequest {
    api_key: String,
    model: String,
    temperature: f32,
    system: String,
    user: String,
    #[serde(default)]
    json_mode: bool,
    #[serde(default)]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct GrokResponse {
    ok: bool,
    content: String,
    error: Option<String>,
}

#[tauri::command]
async fn call_grok(req: GrokRequest) -> Result<GrokResponse, String> {
    // Groq (groq.com) — OpenAI-compatible chat completions.
    // Kept the function name `call_grok` for backward compatibility with the JS caller.
    if req.api_key.trim().is_empty() {
        return Ok(GrokResponse {
            ok: false,
            content: String::new(),
            error: Some("No Groq API key set. Add it in Settings → AI butler.".into()),
        });
    }
    let mut body = serde_json::json!({
        "model": req.model,
        "temperature": req.temperature,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": req.user}
        ]
    });
    if req.json_mode {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    // Give structured-output calls plenty of room — Groq's default 1024 cap
    // can truncate complex JSON schemas mid-generation (triggers json_validate_failed).
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }
    let client = reqwest::Client::new();
    let res = client.post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(&req.api_key)
        .json(&body)
        .send().await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Ok(GrokResponse { ok: false, content: String::new(), error: Some(format!("Groq {}: {}", status, text)) });
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let content = v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
    Ok(GrokResponse { ok: true, content, error: None })
}

// ------------------- SerpAPI proxy -------------------
// SerpAPI blocks browser (CORS) by design. We proxy from Rust so the lesson
// modal can resolve diagrams + YouTube videos without CORS pain.

#[derive(Deserialize)]
struct SerpRequest {
    api_key: String,
    engine: String,   // "google_images" or "youtube"
    query: String,
}

#[derive(Serialize)]
struct SerpResponse {
    ok: bool,
    json: Option<String>,   // raw JSON string from SerpAPI
    error: Option<String>,
}

#[tauri::command]
async fn serp_search(req: SerpRequest) -> Result<SerpResponse, String> {
    if req.api_key.trim().is_empty() {
        return Ok(SerpResponse { ok: false, json: None, error: Some("No SerpAPI key set.".into()) });
    }
    // Validate engine — allowlist so a malicious caller can't hit arbitrary endpoints.
    let allowed_engines = ["google_images", "youtube"];
    if !allowed_engines.contains(&req.engine.as_str()) {
        return Ok(SerpResponse { ok: false, json: None, error: Some(format!("Unsupported engine: {}", req.engine)) });
    }
    // Build query parameters correctly per engine.
    let client = reqwest::Client::new();
    let mut qs = vec![
        ("engine".to_string(), req.engine.clone()),
        ("api_key".to_string(), req.api_key.clone()),
        ("num".to_string(), "5".to_string()),
    ];
    // google_images uses `q`; youtube uses `search_query`
    if req.engine == "youtube" {
        qs.push(("search_query".to_string(), req.query.clone()));
    } else {
        qs.push(("q".to_string(), req.query.clone()));
        qs.push(("safe".to_string(), "active".to_string()));
    }

    let res = client.get("https://serpapi.com/search.json")
        .query(&qs)
        .send().await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Ok(SerpResponse { ok: false, json: None, error: Some(format!("SerpAPI {}: {}", status, text)) });
    }
    Ok(SerpResponse { ok: true, json: Some(text), error: None })
}

// ------------------- YouTube Data API v3 proxy -------------------
// Direct Google API hits from the browser work, but we proxy from Rust to
// keep the API key out of CSP connect-src noise and to add server-side
// validation. Returns candidates guaranteed-embeddable via
// `videoEmbeddable=true` so the uploader-disabled-embed error (code 101/150,
// a.k.a. "153") is impossible.

#[derive(Deserialize)]
struct YouTubeRequest {
    api_key: String,
    query: String,
    #[serde(default)]
    max_results: Option<u32>,
}

#[derive(Serialize)]
struct YouTubeResponse {
    ok: bool,
    json: Option<String>,   // raw JSON string from Google
    error: Option<String>,
}

#[tauri::command]
async fn youtube_search(req: YouTubeRequest) -> Result<YouTubeResponse, String> {
    if req.api_key.trim().is_empty() {
        return Ok(YouTubeResponse { ok: false, json: None, error: Some("No YouTube Data API key set.".into()) });
    }
    let n = req.max_results.unwrap_or(5).clamp(1, 10);
    let client = reqwest::Client::new();
    let qs = vec![
        ("part", "snippet".to_string()),
        ("q", req.query.clone()),
        ("type", "video".to_string()),
        ("videoEmbeddable", "true".to_string()),
        ("videoDuration", "medium".to_string()),
        ("maxResults", n.to_string()),
        ("relevanceLanguage", "en".to_string()),
        ("safeSearch", "moderate".to_string()),
        ("key", req.api_key.clone()),
    ];
    let res = client.get("https://www.googleapis.com/youtube/v3/search")
        .query(&qs)
        .send().await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Ok(YouTubeResponse { ok: false, json: None, error: Some(format!("YouTube Data API {}: {}", status, text)) });
    }
    Ok(YouTubeResponse { ok: true, json: Some(text), error: None })
}

// ------------------- open external URL -------------------
// Tauri's webview blocks `target="_blank"` navigation. We hand external URLs
// off to the OS instead — macOS `open`, Linux `xdg-open`, Windows `start`.

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Allowlist http/https only — never shell out arbitrary strings.
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err(format!("Only http/https URLs allowed, got: {}", u));
    }
    #[cfg(target_os = "macos")]
    let (cmd, args): (&str, Vec<&str>) = ("open", vec![u]);
    #[cfg(target_os = "windows")]
    let (cmd, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", u]);
    #[cfg(target_os = "linux")]
    let (cmd, args): (&str, Vec<&str>) = ("xdg-open", vec![u]);

    std::process::Command::new(cmd)
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Open a URL in a specific browser app (macOS: `open -a "Brave Browser" url`).
// Falls back to the default browser if the app isn't installed. `app` is the
// browser's canonical app name — e.g. "Brave Browser", "Google Chrome", "Safari",
// "Firefox", "Arc". Empty `app` behaves like plain open_url.
#[tauri::command]
fn open_url_with(url: String, app: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err(format!("Only http/https URLs allowed, got: {}", u));
    }
    let app_trimmed = app.trim();
    if app_trimmed.is_empty() {
        return open_url(url);
    }
    #[cfg(target_os = "macos")]
    {
        // `open -a "Brave Browser" https://...` ; macOS silently falls back to
        // default if the app isn't installed only when -a is omitted, so we
        // check first with `-a` and let the shell exit non-zero if missing.
        let status = std::process::Command::new("open")
            .args(&["-a", app_trimmed, u])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        // Fallback to default browser
        return open_url(url);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: targeting a specific browser requires per-OS plumbing;
        // for now fall back to default.
        let _ = app_trimmed;
        return open_url(url);
    }
}

// Fetch a URL and extract its og:image / twitter:image + og:title / <title>.
// Falls back to a favicon URL if no OG image is present.
// Returns JSON: {image_url, title, final_url} (any field may be empty).
#[tauri::command]
async fn fetch_url_preview(url: String) -> Result<String, String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err(format!("Only http/https URLs allowed, got: {}", u));
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; GAIN/0.2 Preview)")
        .timeout(std::time::Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let res = match client.get(u).send().await {
        Ok(r) => r,
        Err(e) => {
            // Network failure — still return a usable favicon via Google's service.
            let host = url_host(u);
            let fallback = favicon_fallback(&host);
            return Ok(format!(
                "{{\"image_url\":\"{}\",\"title\":\"{}\",\"final_url\":\"{}\",\"warn\":\"{}\"}}",
                fallback,
                json_escape(&host),
                json_escape(u),
                json_escape(&e.to_string())
            ));
        }
    };
    let final_url = res.url().to_string();
    let text = res.text().await.map_err(|e| e.to_string())?;
    // Only scan a reasonable prefix — og tags live in <head>.
    let head = &text[..text.len().min(16_384)];

    let image_rel = find_meta(head, &["og:image", "og:image:url", "twitter:image", "twitter:image:src"])
        .unwrap_or_default();
    let title = find_meta(head, &["og:title", "twitter:title"])
        .or_else(|| find_title_tag(head))
        .unwrap_or_default();

    // Resolve relative image URLs against final_url.
    let image_abs = resolve_url(&image_rel, &final_url);
    let image_out = if image_abs.is_empty() {
        favicon_fallback(&url_host(&final_url))
    } else {
        image_abs
    };

    Ok(format!(
        "{{\"image_url\":\"{}\",\"title\":\"{}\",\"final_url\":\"{}\"}}",
        json_escape(&image_out),
        json_escape(&title),
        json_escape(&final_url)
    ))
}

fn find_meta(html: &str, keys: &[&str]) -> Option<String> {
    // Simple regex-free scan — look for `<meta ... property/name="KEY" ... content="VAL" ...>`
    // or with content before property. Case-insensitive on tag name.
    let lower = html.to_ascii_lowercase();
    for key in keys {
        let needle_prop = format!("\"{}\"", key.to_ascii_lowercase());
        let needle_prop2 = format!("'{}'", key.to_ascii_lowercase());
        for needle in &[needle_prop, needle_prop2] {
            let mut idx = 0usize;
            while let Some(pos) = lower[idx..].find(needle) {
                let abs = idx + pos;
                // Look for the enclosing <meta ...> tag
                let tag_start = lower[..abs].rfind("<meta").unwrap_or(0);
                let tag_end = lower[abs..].find('>').map(|e| abs + e).unwrap_or(lower.len());
                if tag_end <= tag_start { idx = abs + needle.len(); continue; }
                let tag = &html[tag_start..=tag_end.min(html.len() - 1)];
                if let Some(val) = extract_attr(tag, "content") {
                    if !val.trim().is_empty() {
                        return Some(val.trim().to_string());
                    }
                }
                idx = abs + needle.len();
            }
        }
    }
    None
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{}=", attr.to_ascii_lowercase());
    let pos = lower.find(&needle)?;
    let after = &tag[pos + needle.len()..];
    let bytes = after.as_bytes();
    if bytes.is_empty() { return None; }
    let (quote, start) = match bytes[0] {
        b'"' | b'\'' => (bytes[0], 1),
        _ => return None,
    };
    let after_q = &after[start..];
    let end = after_q.find(quote as char)?;
    Some(after_q[..end].to_string())
}

fn find_title_tag(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let close = lower[start..].find('>').map(|p| start + p + 1)?;
    let end = lower[close..].find("</title>").map(|p| close + p)?;
    let title = html[close..end].trim();
    if title.is_empty() { None } else { Some(title.to_string()) }
}

fn resolve_url(href: &str, base: &str) -> String {
    let h = href.trim();
    if h.is_empty() { return String::new(); }
    if h.starts_with("http://") || h.starts_with("https://") {
        return h.to_string();
    }
    if h.starts_with("//") {
        // Protocol-relative
        let scheme = if base.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", scheme, h);
    }
    // Rooted path
    if let Some(host_end) = base.find("://").and_then(|s| {
        let rest = &base[s + 3..];
        rest.find('/').map(|p| s + 3 + p)
    }) {
        let origin = &base[..host_end];
        if h.starts_with('/') {
            return format!("{}{}", origin, h);
        }
        return format!("{}/{}", origin, h);
    }
    // Fallback: assume base is the origin
    format!("{}/{}", base.trim_end_matches('/'), h)
}

fn url_host(u: &str) -> String {
    let no_scheme = u.split("://").nth(1).unwrap_or(u);
    no_scheme.split('/').next().unwrap_or(no_scheme).to_string()
}

fn favicon_fallback(host: &str) -> String {
    if host.is_empty() { return String::new(); }
    format!("https://www.google.com/s2/favicons?domain={}&sz=128", host)
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

// ------------------- secure keyring -------------------

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new("com.vikas.gain", &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("com.vikas.gain", &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("com.vikas.gain", &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ------------------- first-run import -------------------

#[tauri::command]
fn first_run_import(app: tauri::AppHandle, source_dir: String) -> Result<Vec<String>, String> {
    let base = data_dir(&app)?;
    let files = [
        "01_DSA_SHEET.csv",
        "02_SYSTEM_DESIGN_SHEET.csv",
        "03_INTEGRATIONS_PLATFORMS_SHEET.csv",
        "04_FDE_INTERVIEW_EXTRAS.csv",
        "05_SQL_SHEET.csv",
        "06_OS_NETWORKING_SHEET.csv",
        "rewards_catalog.csv",
    ];
    let mut imported = vec![];
    for f in files {
        let src = PathBuf::from(&source_dir).join(f);
        if !src.exists() { continue; }
        let dest = base.join(f);
        if !dest.exists() {
            fs::copy(&src, &dest).map_err(|e| format!("import {}: {}", f, e))?;
            imported.push(dest.to_string_lossy().to_string());
        }
    }
    Ok(imported)
}

// ------------------- entry -------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            app_data_dir,
            read_text_file,
            write_text_file,
            file_exists,
            list_backups,
            copy_into_data,
            call_grok,
            serp_search,
            youtube_search,
            open_url,
            open_url_with,
            fetch_url_preview,
            secure_set,
            secure_get,
            secure_delete,
            first_run_import
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running GAIN");
}
