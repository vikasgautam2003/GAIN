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
            secure_set,
            secure_get,
            secure_delete,
            first_run_import
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running GAIN");
}
