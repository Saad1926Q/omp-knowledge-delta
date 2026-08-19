import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LEDGER_FILENAME = "research-ledger.md";
const DATA_DIRECTORY_NAME = "knowledge-delta";

function optionsWithDefaults(options = {}) {
  return {
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    now: options.now ?? new Date(),
  };
}

function getAgentDirectory(options = {}) {
  const env = optionsWithDefaults(options).env;
  const configured = typeof env.PI_CODING_AGENT_DIR === "string"
    ? env.PI_CODING_AGENT_DIR.trim()
    : "";

  return configured || join(optionsWithDefaults(options).home, ".omp", "agent");
}

export function getLedgerPath(options = {}) {
  return join(getAgentDirectory(options), DATA_DIRECTORY_NAME, LEDGER_FILENAME);
}

export async function readLedger(options = {}) {
  const path = getLedgerPath(options);

  try {
    return {
      path,
      content: await fs.readFile(path, "utf8"),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, content: null };
    throw error;
  }
}

function dateStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid ledger date");
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function nextLedgerEntryId(content, date) {
  const stamp = dateStamp(date);
  const expression = new RegExp(`^##\\s+R-${stamp}-(\\d+)(?:\\s|—)`, "gm");
  let next = 1;
  let match;

  while ((match = expression.exec(content ?? ""))) {
    next = Math.max(next, Number(match[1]) + 1);
  }

  return `R-${stamp}-${String(next).padStart(3, "0")}`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function renderLedgerEntry(entry) {
  const title = clean(entry.title) || "Untitled source";
  const lines = [
    `## ${entry.id} — ${title}`,
    "",
    `- Source: ${clean(entry.source) || "Not provided"}`,
    `- Captured: ${clean(entry.captured) || "Not recorded"}`,
    `- Type: ${clean(entry.type) || "unknown"}`,
    `- Attention: ${clean(entry.attention) || "T1"}`,
    `- Status: ${clean(entry.status) || "triaged"}`,
  ];

  if (clean(entry.project)) lines.push(`- Project: ${clean(entry.project)}`);
  if (clean(entry.nextAction)) lines.push(`- Next action: ${clean(entry.nextAction)}`);

  const body = clean(entry.content);
  if (body) lines.push("", body);

  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeLedger(content, path) {
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${path}.bak`;

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);

  let hadExistingLedger = false;
  try {
    await fs.access(path);
    hadExistingLedger = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    if (hadExistingLedger) {
      await fs.copyFile(path, backupPath);
      await fs.chmod(backupPath, 0o600);
    }

    await fs.writeFile(temporaryPath, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, path);
    await fs.chmod(path, 0o600);

    return { path, backupPath: hadExistingLedger ? backupPath : null };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function appendLedgerEntry(entry, options = {}) {
  const resolved = optionsWithDefaults(options);
  const existing = await readLedger(resolved);
  if (Object.hasOwn(options, "expectedContent") && existing.content !== options.expectedContent) {
    throw new Error("Research ledger changed while the entry was pending");
  }
  const id = clean(entry.id) || nextLedgerEntryId(existing.content, resolved.now);
  const rendered = renderLedgerEntry({
    ...entry,
    id,
    captured: clean(entry.captured) || resolved.now.toISOString().slice(0, 10),
  });
  const prefix = existing.content?.trimEnd()
    ? `${existing.content.trimEnd()}\n\n`
    : "# Research Ledger\n\n";
  const result = await writeLedger(`${prefix}${rendered}`, existing.path);

  return {
    ...result,
    id,
    entry: rendered,
  };
}
