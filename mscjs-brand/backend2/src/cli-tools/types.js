/**
 * CLI tool interface (server-side).
 *
 * IMPORTANT:
 * - Tools run on the backend, not on the user's machine.
 * - Keep tools fast, deterministic, and safe.
 * - Do NOT execute arbitrary shell commands or install packages at runtime in production.
 *
 * Tool shape (export from each file in `backend/src/cli-tools/*`):
 *
 * - `id`: string (unique)
 * - `name`: string (display)
 * - `description`: string (optional)
 * - `planIds`: number[] | number | string (optional). If set, only users with an active matching plan_id can use it.
 * - `inputs`: array of input field definitions (optional)
 * - `run(ctx, input)`: async function that returns `{ output: string, data?: object }`
 *
 * `ctx` fields (provided by `/api/cli/tools/run`):
 * - `ip`: string
 * - `userAgent`: string
 * - `user`: { id: number, username: string, isAdmin: boolean }
 * - `session`: { id: string, userId: number }
 * - `token`: string | null (CLI bearer token)
 * - `authHeader`: string | null (e.g. "Bearer <token>")
 *
 * SECURITY NOTE:
 * - Never print `ctx.token` / `ctx.authHeader` in `output`.
 * - Backend will best-effort redact bearer token + password inputs from tool output.
 *
 * Input field definition:
 * - `key`: string (identifier)
 * - `label`: string (UI label)
 * - `type`: "string" | "number" | "checkbox" | "select" | "password"
 * - `required`: boolean (optional)
 * - `placeholder`: string (optional)
 * - `default`: string|number|boolean|null (optional)
 * - `options`: string[] (for "select")
 */

module.exports = {};
