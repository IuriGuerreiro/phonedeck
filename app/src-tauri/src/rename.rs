//! Keeps installs from before the rename to Tapfleet working.
//! - The app id changed from `com.sma.desktop` to `app.tapfleet.desktop`, which moves the
//!   data dir. The old one is moved over on first start.
//! - `sma.db` became `tapfleet.db`.
//! - Env vars are `TAPFLEET_*`; the old `SMA_*` names still work.
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

const OLD_ID: &str = "com.sma.desktop";
const DB: &str = "tapfleet.db";
const OLD_DB: &str = "sma.db";
/// SQLite keeps these next to the database; they move with it.
const DB_SIDECARS: [&str; 2] = ["-wal", "-shm"];
/// Appium saves absolute driver paths here; they must point at the new dir.
const APPIUM_MANIFEST: &str = "tools/appium/node_modules/.cache/appium/extensions.yaml";

/// `TAPFLEET_<name>`, else the old `SMA_<name>`.
pub fn var_os(name: &str) -> Option<OsString> {
    std::env::var_os(format!("TAPFLEET_{name}")).or_else(|| std::env::var_os(format!("SMA_{name}")))
}

/// Like `var_os`, as a string.
pub fn var(name: &str) -> Option<String> {
    var_os(name).and_then(|v| v.into_string().ok())
}

/// The data dir to use. Moves the old one into `dir` if `dir` doesn't exist yet.
/// If the move fails, keeps using the old dir so nothing is lost.
pub fn data_dir(dir: PathBuf) -> PathBuf {
    let old = dir.with_file_name(OLD_ID);
    if dir.exists() || !old.is_dir() {
        return dir;
    }
    // Same parent folder, so this is a plain rename, not a copy.
    if let Err(e) = fs::rename(&old, &dir) {
        eprintln!("[rename] could not move {} to {}: {e}. Using the old folder.", old.display(), dir.display());
        return old;
    }
    println!("[rename] moved {} to {}", old.display(), dir.display());
    fix_appium_manifest(&dir, &old);
    dir
}

fn fix_appium_manifest(dir: &Path, old: &Path) {
    let path = dir.join(APPIUM_MANIFEST);
    let (Ok(text), Some(old), Some(new)) = (fs::read_to_string(&path), old.to_str(), dir.to_str()) else { return };
    if text.contains(old) {
        let _ = fs::write(&path, text.replace(old, new));
    }
}

/// The database in `dir`. Renames `sma.db` (and its -wal/-shm files) to `tapfleet.db` if needed.
/// If that fails, puts back what moved and keeps the old name.
pub fn db_path(dir: &Path) -> PathBuf {
    let (new, old) = (dir.join(DB), dir.join(OLD_DB));
    if new.exists() || !old.exists() {
        return new;
    }
    // Sidecars first, the main file last: a half-done move then still opens the old name.
    let mut moved = vec![];
    for suffix in DB_SIDECARS.iter().copied().chain([""]) {
        let (from, to) = (dir.join(format!("{OLD_DB}{suffix}")), dir.join(format!("{DB}{suffix}")));
        if !from.exists() {
            continue;
        }
        if let Err(e) = fs::rename(&from, &to) {
            eprintln!("[rename] could not rename {}: {e}. Keeping {OLD_DB}.", from.display());
            for (from, to) in moved.into_iter().rev() {
                let _ = fs::rename(to, from);
            }
            return old;
        }
        moved.push((from, to));
    }
    new
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("tapfleet-rename-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn moves_old_data_dir_and_database() {
        let root = temp("move");
        let old = root.join(OLD_ID);
        let manifest = old.join(APPIUM_MANIFEST);
        fs::create_dir_all(manifest.parent().unwrap()).unwrap();
        fs::write(&manifest, format!("installPath: {}/tools/appium\n", old.display())).unwrap();
        fs::write(old.join("sma.db"), "db").unwrap();
        fs::write(old.join("sma.db-wal"), "wal").unwrap();

        let dir = data_dir(root.join("app.tapfleet.desktop"));
        assert_eq!(dir, root.join("app.tapfleet.desktop"));
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(dir.join(APPIUM_MANIFEST)).unwrap(), format!("installPath: {}/tools/appium\n", dir.display()));

        assert_eq!(db_path(&dir), dir.join("tapfleet.db"));
        assert_eq!(fs::read_to_string(dir.join("tapfleet.db")).unwrap(), "db");
        assert_eq!(fs::read_to_string(dir.join("tapfleet.db-wal")).unwrap(), "wal");
        assert!(!dir.join("sma.db").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn leaves_existing_new_dir_alone() {
        let root = temp("keep");
        fs::create_dir_all(root.join(OLD_ID)).unwrap();
        fs::create_dir_all(root.join("app.tapfleet.desktop")).unwrap();
        assert_eq!(data_dir(root.join("app.tapfleet.desktop")), root.join("app.tapfleet.desktop"));
        assert!(root.join(OLD_ID).exists());
        assert_eq!(db_path(&root), root.join("tapfleet.db"));
        let _ = fs::remove_dir_all(&root);
    }
}
