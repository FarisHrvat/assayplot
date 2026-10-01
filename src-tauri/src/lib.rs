mod updater;

use std::path::Path;
use std::sync::Mutex;

/// Projects the system asked us to open (a double-clicked .asp), waiting for
/// the window to pick them up.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

fn project_paths(candidates: impl IntoIterator<Item = String>) -> Vec<String> {
    candidates
        .into_iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            (lower.ends_with(".asp") || lower.ends_with(".assayplot")) && Path::new(path).is_file()
        })
        .collect()
}

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows and Linux pass the file on the command line.
    let from_args = project_paths(std::env::args().skip(1));

    let app = tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(from_args)))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            take_opened_files,
            updater::check_update,
            updater::download_update,
            updater::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while running AssayPlot");

    app.run(|_app, _event| {
        // macOS sends an event instead, also while the app is already running.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            use tauri::{Emitter, Manager};
            let paths = project_paths(
                urls.into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned()),
            );
            if !paths.is_empty() {
                _app.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
                let _ = _app.emit_to("main", "open-files", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::project_paths;

    #[test]
    fn only_existing_project_files_are_taken() {
        let dir = std::env::temp_dir().join("assayplot-open-test");
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.join("Results.ASP");
        std::fs::write(&project, b"PK").unwrap();
        let project = project.to_string_lossy().into_owned();

        let picked = project_paths(vec![
            project.clone(),
            dir.join("missing.asp").to_string_lossy().into_owned(),
            "--some-flag".into(),
            dir.join("data.csv").to_string_lossy().into_owned(),
        ]);
        assert_eq!(picked, vec![project]);
    }
}
