// graph-service/src/capabilities/ports.ts
//
// The bundle type the driver and `compose()` pass around — one field per engine-recognized
// capability port, typed against the engine's own port interfaces so either a faked or a real
// implementation satisfies it structurally. `compose()` wires this to `capabilities/fakes.ts`
// today; a real implementation (actual process spawn, git, filesystem, human prompt) drops in
// here unchanged in a later phase (the 2.4 seam) — nothing that consumes `CapabilityPorts` needs
// to change when that swap happens.
import type {
  DocReadPort,
  DocWritePort,
  GitFactsPort,
  RequestHumanPort,
  RunCommandPort,
  SpawnAgentPort,
} from '@rad-orchestration/graph-engine';

export interface CapabilityPorts {
  readonly docRead: DocReadPort;
  readonly docWrite: DocWritePort;
  readonly gitFacts: GitFactsPort;
  readonly spawnAgent: SpawnAgentPort;
  readonly runCommand: RunCommandPort;
  readonly requestHuman: RequestHumanPort;
}
