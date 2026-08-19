import {
  buildProfilePrompt,
  profileCommandHelp,
} from "./profile/prompt.js";
import {
  deleteProfile,
  formatProfileDiff,
  getProfilePath,
  readProfile,
  writeProfile,
} from "./profile/storage.js";
import {
  buildTriagePrompt,
  triageCommandHelp,
} from "./triage/prompt.js";

function isConfirmed(value) {
  return value === true || value?.confirmed === true;
}

async function collectInput(
  args,
  ctx,
  title = "Research profile",
  editorPlaceholder = "Tell me what should be captured",
) {
  const provided = args.trim();
  if (provided) return provided;

  if (typeof ctx.ui?.editor === "function") {
    const value = await ctx.ui.editor(title, editorPlaceholder);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  if (typeof ctx.ui?.input === "function") {
    const value = await ctx.ui.input(title, editorPlaceholder);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function sendPrompt(pi, ctx, prompt) {
  if (typeof ctx.isIdle !== "function" || ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
}

function commandParts(args) {
  const trimmed = args.trim();
  if (!trimmed) return { command: null, rest: "" };

  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return {
    command: match[1].toLowerCase(),
    rest: match[2]?.trim() ?? "",
  };
}

async function handleShow(pi, ctx) {
  const profile = await readProfile();
  if (!profile.content) {
    ctx.ui?.notify?.(
      "No research profile exists yet. Run /research-profile to create one.",
      "info",
    );
    return;
  }

  pi.sendMessage(
    {
      customType: "omp-knowledge-delta.profile",
      content: `## Current research profile\n\n${profile.content}`,
      display: true,
      attribution: "user",
    },
    { triggerTurn: false },
  );
}

async function handleDelete(ctx) {
  const profile = await readProfile();
  if (!profile.content) {
    ctx.ui?.notify?.("No research profile exists.", "info");
    return;
  }

  if (typeof ctx.ui?.confirm !== "function") {
    ctx.ui?.notify?.(
      `Deletion requires interactive confirmation: ${profile.path}`,
      "warning",
    );
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Delete research profile?",
    `This removes ${profile.path}. The research ledger is not affected.`,
  );
  if (!isConfirmed(confirmed)) {
    ctx.ui.notify("Research profile was not deleted.", "info");
    return;
  }

  const result = await deleteProfile();
  ctx.ui.notify(
    result.deleted ? "Research profile deleted." : "No research profile found.",
    "info",
  );
}

async function handleTriageCommand(pi, args, ctx) {
  if (args.trim().toLowerCase() === "help") {
    ctx.ui?.notify?.(triageCommandHelp(), "info");
    return;
  }

  const source = await collectInput(
    args,
    ctx,
    "Research source",
    "Paste a URL or describe the post, paper, or claim to triage",
  );
  if (!source) {
    ctx.ui?.notify?.(
      "Nothing to triage. Provide a URL or pasted text after /research-triage.",
      "warning",
    );
    return;
  }

  sendPrompt(pi, ctx, buildTriagePrompt({ source }));
}


async function handleProfileCommand(pi, args, ctx) {
  const { command, rest } = commandParts(args);

  if (command === "help") {
    ctx.ui?.notify?.(profileCommandHelp(), "info");
    return;
  }

  if (command === "show") {
    await handleShow(pi, ctx);
    return;
  }

  if (command === "delete" || command === "remove") {
    await handleDelete(ctx);
    return;
  }

  const profile = await readProfile();
  const action = command === "update" ? "update" : "create";
  const input = command === "update" || command === "create"
    ? await collectInput(rest, ctx)
    : await collectInput(args, ctx);

  if (!input) {
    ctx.ui?.notify?.(
      "Nothing captured. Add free-form text after /research-profile or use the editor.",
      "warning",
    );
    return;
  }

  sendPrompt(
    pi,
    ctx,
    buildProfilePrompt({
      action: action === "create" && profile.content ? "update" : action,
      input,
    }),
  );
}

export default function ompKnowledgeDelta(pi) {
  const z = pi.zod;
  pi.setLabel("Knowledge Delta");

  pi.registerCommand("research-profile", {
    description: "Create, inspect, update, or delete the research profile",
    handler: handleProfileCommand,
  });
  pi.registerCommand("research-triage", {
    description: "Triage a paper, post, blog, or pasted research claim",
    handler: handleTriageCommand,
  });

  pi.registerTool({
    name: "research_profile_read",
    label: "Read Research Profile",
    description: "Read the current user-controlled research profile.",
    parameters: z.object({}),
    approval: "read",
    async execute() {
      const profile = await readProfile();
      return {
        content: [{
          type: "text",
          text: profile.content
            ? `Profile path: ${profile.path}\n\n${profile.content}`
            : `No profile exists at ${profile.path}.`,
        }],
        details: {
          path: profile.path,
          exists: Boolean(profile.content),
        },
      };
    },
  });

  pi.registerTool({
    name: "research_profile_update",
    label: "Update Research Profile",
    description: "Preview and, after explicit confirmation, save a complete research profile.",
    parameters: z.object({
      content: z.string(),
      summary: z.string().optional(),
    }),
    approval: "write",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = await readProfile();
      const proposed = params.content.trimEnd() + "\n";
      const diff = formatProfileDiff(current.content ?? "", proposed);

      if (diff === "No changes.") {
        return {
          content: [{ type: "text", text: "The proposed profile has no changes." }],
          details: { changed: false, path: current.path },
        };
      }

      if (typeof ctx.ui?.confirm !== "function") {
        return {
          content: [{
            type: "text",
            text: "Profile update was not written because interactive confirmation is unavailable.\n\n" + diff,
          }],
          details: { changed: false, requiresConfirmation: true, path: current.path },
        };
      }

      const confirmed = await ctx.ui.confirm(
        "Apply research profile update?",
        [params.summary, diff].filter(Boolean).join("\n\n"),
      );
      if (!isConfirmed(confirmed)) {
        return {
          content: [{ type: "text", text: "Profile update cancelled; no file was changed." }],
          details: { changed: false, path: current.path },
        };
      }

      const latest = await readProfile();
      if ((latest.content ?? "") !== (current.content ?? "")) {
        return {
          content: [{
            type: "text",
            text: "Profile changed while this proposal was pending. No update was written; please reread and propose it again.",
          }],
          details: { changed: false, stale: true, path: current.path },
        };
      }

      const saved = await writeProfile(proposed);
      return {
        content: [{ type: "text", text: `Research profile updated at ${saved.path}.` }],
        details: {
          changed: true,
          path: saved.path,
          backupPath: saved.backupPath,
          summary: params.summary ?? null,
        },
      };
    },
  });
}

export {
  collectInput,
  commandParts,
  getProfilePath,
  handleTriageCommand,
};
