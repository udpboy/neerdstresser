const fs = require("fs");
const path = require("path");

const loadTools = () => {
  const dir = __dirname;
  const toolFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => f !== "index.js" && f !== "types.js")
    .sort((a, b) => a.localeCompare(b));

  const tools = [];
  const seen = new Set();
  for (const file of toolFiles) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const tool = require(path.join(dir, file));
      const id = tool?.id ? String(tool.id) : "";
      if (!id || typeof tool?.run !== "function") continue;
      if (seen.has(id)) continue;
      seen.add(id);
      tools.push(tool);
    } catch {
      // Skip broken tools to avoid crashing the CLI route.
    }
  }

  return tools;
};

const tools = loadTools();

const byId = new Map(tools.map((t) => [String(t.id), t]));

const normalizePlanIds = (value) => {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [value];
  const out = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
};

const isToolAllowed = (tool, { planId }) => {
  const allowedPlanIds = normalizePlanIds(tool?.planIds ?? tool?.plans ?? tool?.plan);
  if (!allowedPlanIds.length) return true;

  const pid = Number(planId);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return allowedPlanIds.includes(pid);
};

const listTools = ({ planId }) => {
  return tools
    .filter((t) => isToolAllowed(t, { planId }))
    .map((t) => {
      const inputs = Array.isArray(t.inputs) ? t.inputs : [];
      return {
        id: String(t.id),
        name: String(t.name || t.id),
        description: String(t.description || ""),
        inputs,
        hasInput: inputs.length > 0,
      };
    });
};

const getTool = (id) => byId.get(String(id)) || null;

module.exports = { listTools, getTool, isToolAllowed, normalizePlanIds };
