import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendLedgerEntry,
  getLedgerPath,
  readLedger,
  renderLedgerEntry,
} from "../src/ledger/storage.js";

const temporaryDirectories = [];

async function testOptions() {
  const home = await mkdtemp(join(tmpdir(), "omp-knowledge-delta-ledger-"));
  temporaryDirectories.push(home);
  return {
    home,
    env: {},
    now: new Date("2026-08-20T12:00:00.000Z"),
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  while (temporaryDirectories.length) {
    await rm(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("research ledger storage", () => {
  it("uses the configured agent directory", () => {
    assert.equal(
      getLedgerPath({ env: { PI_CODING_AGENT_DIR: "/tmp/omp-agent" }, home: "/tmp/home" }),
      "/tmp/omp-agent/knowledge-delta/research-ledger.md",
    );
  });

  it("renders a structured entry without requiring optional fields", () => {
    const rendered = renderLedgerEntry({
      id: "R-20260820-001",
      title: "Example paper",
      source: "https://example.com/paper",
      captured: "2026-08-20",
      attention: "T2",
      content: "### Delta\n\nThe method changes the baseline.",
    });

    assert.match(rendered, /^## R-20260820-001 — Example paper/m);
    assert.match(rendered, /- Attention: T2/);
    assert.match(rendered, /### Delta/);
  });

  it("creates the ledger and increments entry IDs", async () => {
    const options = await testOptions();
    const first = await appendLedgerEntry({
      title: "First paper",
      source: "https://example.com/one",
      attention: "T1",
      content: "### Delta\n\nFirst delta.",
    }, options);
    const second = await appendLedgerEntry({
      title: "Second paper",
      source: "https://example.com/two",
      attention: "T2",
      content: "### Delta\n\nSecond delta.",
    }, options);

    assert.equal(first.id, "R-20260820-001");
    assert.equal(second.id, "R-20260820-002");
    assert.match(await readFile(first.path, "utf8"), /# Research Ledger/);
    assert.match(await readFile(first.path, "utf8"), /First paper/);
    assert.match(await readFile(first.path, "utf8"), /Second paper/);
    assert.equal((await readLedger(options)).content.includes("Second delta."), true);
    assert.equal(await stat(`${second.path}.bak`).then(() => true), true);
  });
  it("rejects an append when the ledger changed after the preview", async () => {
    const options = await testOptions();
    const first = await appendLedgerEntry({
      title: "Existing paper",
      source: "https://example.com/existing",
      attention: "T1",
      content: "### Delta\n\nExisting delta.",
    }, options);

    await assert.rejects(
      appendLedgerEntry(
        {
          title: "Stale paper",
          source: "https://example.com/stale",
          attention: "T2",
          content: "### Delta\n\nStale delta.",
        },
        {
          ...options,
          expectedContent: null,
        },
      ),
      /ledger changed while the entry was pending/,
    );
    assert.match(await readFile(first.path, "utf8"), /Existing paper/);
    assert.doesNotMatch(await readFile(first.path, "utf8"), /Stale paper/);
  });
});
