# Helper & Automation Scripts

This folder contains utility scripts for syncing, environment setup, and routine maintenance of the Second Brain.

---

## 📜 Available Scripts

### 1. `download_brain.sh`
Clones or updates your private/public Obsidian Second Brain GitHub repository into the local `database/` directory.

#### Usage:
1. Ensure `.env` is configured at the root of the project:
   ```bash
   cp .env.example .env
   # Edit .env and set:
   # OBSIDIAN_BRAIN_REPO_URL=git@github.com:your-user/your-obsidian-second-brain.git
   ```
2. Run the script:
   ```bash
   ./scripts/download_brain.sh
   ```

> [!NOTE]
> The target `database/` folder is listed in `.gitignore` to prevent committing your personal knowledge base into this system repository.

### 2. `sync_dropbox.sh`
Syncs with Dropbox **what git doesn't keep**: everything in `database/` except the Markdown notes. That
means the SQLite database, logs and any other files. The notes are versioned in git and pushed to
GitHub (`database/.gitignore` lets only `.md` files in), so the two never overlap:

| Where | What |
| :--- | :--- |
| GitHub (`database/` git repository) | the `.md` notes and their history |
| Dropbox (`second-brain/`) | everything else: `database_files/` (SQLite database, logs), any non-Markdown file |

#### Setup (once)
```bash
sudo pacman -S rclone
rclone config        # n (new remote) -> name: dropbox -> storage: dropbox -> defaults -> log in in the browser
```
Optional `.env` settings: `DROPBOX_REMOTE` (the rclone remote name, default `dropbox`) and `DROPBOX_PATH`
(the folder inside Dropbox, default `second-brain`).

#### Usage
```bash
./scripts/sync_dropbox.sh              # push: make Dropbox match database/
./scripts/sync_dropbox.sh pull         # bring files that are newer on Dropbox into database/
./scripts/sync_dropbox.sh check        # compare both sides, change nothing
./scripts/sync_dropbox.sh --dry-run    # show what a push would do
```

#### Safety rules
- **Push keeps old versions:** files that a push changes or deletes on Dropbox are kept in
  `second-brain-versions/<date-time>` there.
- **Pull never deletes:** it only copies files that are newer on Dropbox into `database/`.
- **Not while a crawler runs:** it refuses while a crawler is writing the database, unless you pass
  `--force`, so Dropbox never gets a half-written copy.
- **No empty pushes:** it refuses to push when `database/` has nothing for Dropbox.
- **Left out:** the notes and `.gitignore` (they're in git), `.git`, lock files and SQLite's temporary
  files.

