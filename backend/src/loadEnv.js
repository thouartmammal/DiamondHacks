/**
 * Load .env from fixed paths so AGENTVERSE_* and keys work even when
 * process.cwd() is the repo root (e.g. npm run dev:all + concurrently).
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");
const repoRoot = path.join(backendRoot, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env"), override: true });
