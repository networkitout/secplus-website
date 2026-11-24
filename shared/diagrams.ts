export const DIAGRAM_NAMES = [
  'control-types-matrix',
  'cia-triad',
  'aaa-flow',
  'zero-trust-planes',
  'change-management-flow',
  'symmetric-vs-asymmetric',
  'hashing-salting',
  'pki-trust-chain',
  'tls-handshake',
] as const;

export type DiagramName = (typeof DIAGRAM_NAMES)[number];
