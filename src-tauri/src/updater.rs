//! Checking GitHub for a newer release, and fetching it.
//!
//! Tauri ships an updater plugin, but it requires every release to be signed
//! with a key held as a repository secret. This does the same job with the
//! public releases API and no key material, and it hands the installer to the
//! platform's own mechanism rather than swapping files underneath a running
//! process.

use std::path::PathBuf;

const RELEASES: &str = "https://api.github.com/repos/FarisHrvat/assayplot/releases/latest";
const AGENT: &str = concat!("AssayPlot/", env!("CARGO_PKG_VERSION"));

#[derive(serde::Serialize, Clone)]
pub struct Update {
    pub version: String,
    pub current: String,
    pub notes: String,
    pub url: String,
    pub filename: String,
    pub bytes: u64,
    pub page: String,
    /// What happens after the download, so the dialog can say so before it starts.
    pub instruction: String,
}

/// Compares dotted versions numerically. "0.10.0" is newer than "0.9.0", which
/// a string comparison gets backwards.
fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim_start_matches('v')
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse().ok())
            .collect()
    };
    let (a, b) = (parse(candidate), parse(current));
    for index in 0..a.len().max(b.len()) {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

/// The asset built for the machine this is running on, and what to do with it.
fn wanted_asset(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if cfg!(target_os = "macos") {
        let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
        if lower.ends_with(".dmg") && lower.contains(arch) {
            return Some(
                "The disk image opens when the download finishes. Drag AssayPlot onto \
                 Applications and choose Replace when asked.",
            );
        }
    } else if cfg!(target_os = "windows") {
        if lower.ends_with("-setup.exe") {
            return Some(
                "The installer runs when the download finishes. It replaces this version \
                 in place; AssayPlot will close first.",
            );
        }
    } else if cfg!(target_os = "linux") {
        if lower.ends_with(".appimage") {
            return Some(
                "The AppImage is saved to your Downloads folder and marked executable. \
                 Replace the copy you are running with it.",
            );
        }
    }
    None
}

#[tauri::command]
pub async fn check_update() -> Result<Option<Update>, String> {
    let client = reqwest::Client::builder()
        .user_agent(AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(RELEASES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("GitHub could not be reached: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub answered {}.", response.status()));
    }

    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("GitHub's answer could not be read: {error}"))?;

    let tag = release["tag_name"].as_str().unwrap_or_default().to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    if tag.is_empty() || !is_newer(&tag, &current) {
        return Ok(None);
    }

    let empty = Vec::new();
    let assets = release["assets"].as_array().unwrap_or(&empty);
    for asset in assets {
        let name = asset["name"].as_str().unwrap_or_default();
        if let Some(instruction) = wanted_asset(name) {
            return Ok(Some(Update {
                version: tag.trim_start_matches('v').to_string(),
                current,
                notes: release["body"].as_str().unwrap_or_default().to_string(),
                url: asset["browser_download_url"].as_str().unwrap_or_default().to_string(),
                filename: name.to_string(),
                bytes: asset["size"].as_u64().unwrap_or(0),
                page: release["html_url"].as_str().unwrap_or_default().to_string(),
                instruction: instruction.to_string(),
            }));
        }
    }

    // A release exists but carries nothing for this platform. Say so rather
    // than pretending there is no update.
    Err(format!(
        "Version {tag} is available, but it has no build for this system. Download it from the releases page."
    ))
}

fn downloads_dir() -> PathBuf {
    dirs_next::download_dir()
        .or_else(dirs_next::home_dir)
        .unwrap_or_else(std::env::temp_dir)
}

#[tauri::command]
pub async fn download_update(url: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent(AGENT)
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;

    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("The download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("The download was cut short: {error}"))?;

    // Never overwrite something already sitting in Downloads.
    let mut target = downloads_dir().join(&filename);
    let stem = target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let extension = target.extension().map(|s| s.to_string_lossy().to_string());
    let mut attempt = 1;
    while target.exists() {
        let name = match &extension {
            Some(ext) => format!("{stem} ({attempt}).{ext}"),
            None => format!("{stem} ({attempt})"),
        };
        target = downloads_dir().join(name);
        attempt += 1;
    }

    std::fs::write(&target, &bytes)
        .map_err(|error| format!("The download could not be saved to {}: {error}", target.display()))?;

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        if target.extension().is_some_and(|e| e.eq_ignore_ascii_case("appimage")) {
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
        }
    }

    Ok(target.to_string_lossy().to_string())
}

/// Hands the downloaded file to the platform. On Windows the installer takes
/// over and this process has to stand aside, so the caller exits afterwards.
#[tauri::command]
pub fn install_update(path: String) -> Result<bool, String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("{path} is no longer there. Download it again."));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&target)
            .spawn()
            .map_err(|error| format!("The installer would not start: {error}"))?;
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("The disk image would not open: {error}"))?;
        return Ok(false);
    }

    #[cfg(target_os = "linux")]
    {
        // Show it in the file manager rather than running it: replacing a
        // running AppImage from inside itself does not end well.
        let parent = target.parent().unwrap_or(&target);
        let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        return Ok(false);
    }

    #[allow(unreachable_code)]
    Ok(false)
}
