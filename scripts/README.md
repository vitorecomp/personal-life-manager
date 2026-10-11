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
