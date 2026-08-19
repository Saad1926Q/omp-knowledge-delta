import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ompKnowledgeDelta, { commandParts } from "../src/index.js";
import {
  deleteProfile,
  formatProfileDiff,
  getDataDirectory,
  getProfilePath,
  readProfile,
  writeProfile,
} from "../src/profile/storage.js";

const temporaryDirectories = [];

async function testOptions() {
  const home = await mkdtemp(join(tmpdir(), "omp-knowledge-delta-"));
  temporaryDirectories.push(home);
  return {
    home,
    env: {},
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  while (temporaryDirectories.length) {
    await rm(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("profile storage", () => {
  it("uses the configured OMP agent directory", () => {
    const options = { env: { PI_CODING_AGENT_DIR: "/tmp/omp-agent" }, home: "/tmp/home" };
    assert.equal(getDataDirectory(options), "/tmp/omp-agent/knowledge-delta");
    assert.equal(
      getProfilePath(options),
      "/tmp/omp-agent/knowledge-delta/research-profile.md",
    );
  });

  it("reads a missing profile without creating it", async () => {
    const options = await testOptions();
    const profile = await readProfile(options);

    assert.equal(profile.content, null);
    await assert.rejects(stat(profile.path), { code: "ENOENT" });
  });

  it("writes atomically, normalizes the newline, and creates a backup", async () => {
    const options = await testOptions();
    const first = await writeProfile("# Profile\n\n- First", options);
    assert.equal(await readFile(first.path, "utf8"), "# Profile\n\n- First\n");
    assert.equal(first.backupPath, null);

    const second = await writeProfile("# Profile\n\n- Second", options);
    assert.equal(await readFile(second.path, "utf8"), "# Profile\n\n- Second\n");
    assert.equal(await readFile(second.backupPath, "utf8"), "# Profile\n\n- First\n");
  });

  it("deletes the profile and its backup", async () => {
    const options = await testOptions();
    await writeProfile("# Profile", options);
    await writeProfile("# Updated", options);

    const result = await deleteProfile(options);
    assert.equal(result.deleted, true);
    assert.equal((await readProfile(options)).content, null);
    await assert.rejects(stat(`${result.path}.bak`), { code: "ENOENT" });
  });
});

describe("profile helpers", () => {
  it("renders a concise changed-line diff", () => {
    const diff = formatProfileDiff("# Profile\n\n- Old\n", "# Profile\n\n- New\n");
    assert.match(diff, /- - Old/);
    assert.match(diff, /\+ - New/);
  });

  it("parses namespaced profile commands without losing free-form text", () => {
    assert.deepEqual(commandParts("update I am focusing on retrieval"), {
      command: "update",
      rest: "I am focusing on retrieval",
    });
    assert.deepEqual(commandParts("show"), { command: "show", rest: "" });
    assert.deepEqual(commandParts(""), { command: null, rest: "" });
  });
});

describe("extension registration", () => {
  it("registers the profile and triage commands with guarded profile tools", () => {
    const commands = [];
    const tools = [];
    const labels = [];
    const chainableString = () => ({
      optional() {
        return this;
      },
    });
    const pi = {
      zod: {
        object(shape) {
          return shape;
        },
        string: chainableString,
      },
      setLabel(label) {
        labels.push(label);
      },
      registerCommand(name, definition) {
        commands.push({ name, definition });
      },
      registerTool(definition) {
        tools.push(definition);
      },
    };

    ompKnowledgeDelta(pi);

    assert.deepEqual(labels, ["Knowledge Delta"]);
    assert.deepEqual(
      commands.map(({ name }) => name),
      ["research-profile", "research-triage"],
    );
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["research_profile_read", "research_profile_update"],
    );
  });
});
