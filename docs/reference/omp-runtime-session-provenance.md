# OMP runtime session provenance

The status extension uses `ctx.agentKind === 'sub'`, when provided by OMP, to
reject child callbacks before they can claim a pane. The value must describe the
current runtime session, not the ancestry of its transcript. A child transcript
resumed directly as the pane's main session must still report status.

This optional extension-context field requires an OMP runtime change. The reviewed
OMP source at e7546987ca526eac8f605fac19ef9805b8f01898 already computes `agentKind`
in its SDK, but does not expose it through ExtensionRunner.createContext. A local
runtime proposal forwards that value to extension callbacks. It is not released
or installed by this Orca change.

Older runtimes retain the manager-identity guard. That guard assumes the main
session reaches Orca's callback before any child. An earlier user extension can
initialize a child during session_start and violate that assumption. Keep the
ownership merge assessment conditional until the runtime API is available and the
combined flow is validated. Neither callback timeouts, UI presence, nor transcript
paths establish runtime ownership.

The guard remains scoped to one pane and launch token. It does not define how
several independent SDK/ACP roots sharing one process and pane should be attributed.
