import type { ComponentType } from 'react';
import type { DiagramName } from '../../../../shared/diagrams';
import { AaaFlow } from './AaaFlow';
import { ChangeManagementFlow } from './ChangeManagementFlow';
import { CiaTriad } from './CiaTriad';
import { ControlTypesMatrix } from './ControlTypesMatrix';
import { HashingSalting } from './HashingSalting';
import { PkiTrustChain } from './PkiTrustChain';
import { SymmetricVsAsymmetric } from './SymmetricVsAsymmetric';
import { TlsHandshake } from './TlsHandshake';
import { ZeroTrustPlanes } from './ZeroTrustPlanes';

/** The diagram component for each name a lesson may use in `:::diagram <name>`. */
export const DIAGRAMS: Record<DiagramName, ComponentType> = {
  'control-types-matrix': ControlTypesMatrix,
  'cia-triad': CiaTriad,
  'aaa-flow': AaaFlow,
  'zero-trust-planes': ZeroTrustPlanes,
  'change-management-flow': ChangeManagementFlow,
  'symmetric-vs-asymmetric': SymmetricVsAsymmetric,
  'hashing-salting': HashingSalting,
  'pki-trust-chain': PkiTrustChain,
  'tls-handshake': TlsHandshake,
};
