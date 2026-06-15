const repos = [{
  "name": "rad-orc-source",
  "path": "C:\Users\Metal\.radorc\worktrees\TELEMETRY-1\rad-orc-source",
  "message": `feat(P02-T01): Neutral schema, NDJSON sink, checkpoint store

Implement core telemetry storage infrastructure: a schema-versioned record type, NDJSON sink with daily partitioning by session, file-based checkpoint store with lock semantics, and aged partition pruning. Covers FR-5, FR-6, NFR-2, NFR-3, NFR-7 requirements.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
}];
console.log(JSON.stringify(repos));
