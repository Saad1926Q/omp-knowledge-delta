# omp-knowledge-delta

## Motivation

Keeping up with research can easily turn into collecting an endless backlog of papers, posts, and blogs to read “later.” Most of those items do not deserve equal attention: some are directly relevant to current work, some only need a quick skim, and many can be safely ignored.

`omp-knowledge-delta` is intended to make that decision easier. Given a source, it will use the user’s current goals and knowledge to establish the relevant prior context, extract what is genuinely new—the **knowledge delta**—and recommend whether the source deserves no further attention, a skim, a focused read, or deep study.

The goal is not to summarize and save more material. It is to reduce information overload and turn research discovery into deliberate learning.

## Disclosure

This is AI-generated code, and I have not reviewed the code in detail. This is
primarily a utility I made for myself, so I did not spend much time on code
quality; I mainly wanted a working thing.

## Profile workflow

The first feature is a user-controlled research profile:

1. Run `/research-profile` and describe your goals, projects, interests, and
   background naturally.
2. The model extracts relevant information and asks only essential follow-up
   questions.
3. The extension shows the proposed profile changes.
4. The profile is saved only after explicit confirmation.

Use `/research-profile update <text>` to propose changes later,
`/research-profile show` to inspect the profile, and
`/research-profile delete` to delete it after confirmation.

## Profile commands

```text
/research-profile
/research-profile update I am now focusing on retrieval evaluation
/research-profile show
/research-profile delete
```

Profile data is stored locally outside this repository under:

```text
~/.omp/agent/knowledge-delta/research-profile.md
```

Set `PI_CODING_AGENT_DIR` to use another OMP agent directory. The extension
keeps a backup when updating an existing profile and never writes profile data
into the Git repository.

## Development

```bash
npm test
```

Load the repository during development with:

```yaml
extensions:
  - /path/to/omp-knowledge-delta
```
