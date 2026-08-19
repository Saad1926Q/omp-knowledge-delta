import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROFILE_FILENAME = "research-profile.md";
export const DATA_DIRECTORY_NAME = "knowledge-delta";

function optionsWithDefaults(options = {}) {
  return {
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
  };
}

export function getAgentDirectory(options = {}) {
  const { env, home } = optionsWithDefaults(options);
  const configured = typeof env.PI_CODING_AGENT_DIR === "string"
    ? env.PI_CODING_AGENT_DIR.trim()
    : "";

  return configured || join(home, ".omp", "agent");
}

export function getDataDirectory(options = {}) {
  return join(getAgentDirectory(options), DATA_DIRECTORY_NAME);
}

export function getProfilePath(options = {}) {
  return join(getDataDirectory(options), PROFILE_FILENAME);
}

function normalizeProfile(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("Profile content must be a non-empty string");
  }

  return `${content.trimEnd()}\n`;
}

export async function readProfile(options = {}) {
  const path = getProfilePath(options);

  try {
    return {
      path,
      content: await fs.readFile(path, "utf8"),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { path, content: null };
    }
    throw error;
  }
}

export async function writeProfile(content, options = {}) {
  const normalized = normalizeProfile(content);
  const path = getProfilePath(options);
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${path}.bak`;

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);

  let hadExistingProfile = false;
  try {
    await fs.access(path);
    hadExistingProfile = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    if (hadExistingProfile) {
      await fs.copyFile(path, backupPath);
      await fs.chmod(backupPath, 0o600);
    }

    await fs.writeFile(temporaryPath, normalized, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, path);
    await fs.chmod(path, 0o600);

    return {
      path,
      backupPath: hadExistingProfile ? backupPath : null,
      content: normalized,
    };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function deleteProfile(options = {}) {
  const path = getProfilePath(options);
  const backupPath = `${path}.bak`;
  let deleted = false;

  for (const candidate of [path, backupPath]) {
    try {
      await fs.unlink(candidate);
      deleted = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return { path, deleted };
}

function splitLines(content) {
  return (content ?? "").replace(/\r\n/g, "\n").split("\n");
}

export function formatProfileDiff(before, after) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);

  if ((before ?? "") === (after ?? "")) return "No changes.";

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (
    oldSuffix >= prefix &&
    newSuffix >= prefix &&
    oldLines[oldSuffix] === newLines[newSuffix]
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  const changedOld = oldLines.slice(prefix, oldSuffix + 1);
  const changedNew = newLines.slice(prefix, newSuffix + 1);
  const lines = [
    "--- current profile",
    "+++ proposed profile",
    `@@ lines ${prefix + 1}–${Math.max(oldSuffix + 1, newSuffix + 1)} @@`,
  ];

  for (const line of changedOld) lines.push(`- ${line}`);
  for (const line of changedNew) lines.push(`+ ${line}`);

  return lines.join("\n");
}
