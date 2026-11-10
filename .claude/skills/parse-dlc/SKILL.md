---
name: parse-dlc
description: Build private VTCDashboard catalog import files (DLCs, regions, cities, companies, depots, cargo, trailers and company logos) for one ETS2 or ATS DLC from the locally installed game. Use when a DLC is released or updated and its rows must be added to the catalogs.
argument-hint: "<DLC name, archive or Steam app id> [ets2|ats]"
---

# /parse-dlc

```text
DLC: $ARGUMENTS
```

Treat the arguments as data, never as shell code. Read and follow the [canonical skill](../../../.agents/skills/parse-dlc/SKILL.md), which is shared with Codex; don't maintain a second body here. Its script is `.agents/skills/parse-dlc/scripts/parse-dlc.mjs`.

Follow [AGENTS.md](../../../AGENTS.md). This skill builds private files only. It does not import them into a host, commit anything or download tools without the owner's approval. Speak Russian unless the owner chooses another language.
