import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Never trust, always verify',
    description:
      'In a Zero Trust architecture nothing is trusted because of where it is on the network. Every request to reach a resource is checked. The work is split into two planes: the control plane decides who may have access, and the data plane carries the traffic and enforces the decision.',
  },
  {
    title: 'Data plane: subject/system, enforcement point, resource',
    description:
      'The subject is whoever or whatever asks for access: a user, an application or a service. The system is the device it uses, and both are checked. The request does not go straight to the resource. It first meets the policy enforcement point (PEP), the gatekeeper that sits in the path and allows, monitors or ends the connection.',
  },
  {
    title: 'Control plane: the policy engine decides',
    description:
      'The enforcement point holds the request and passes its details up. The policy engine makes the decision to grant, deny or revoke access. The policy engine applies policy-driven access control: it decides from written policy rules and from what it knows about the subject and its device, not from where the request comes from.',
  },
  {
    title: 'Control plane: the policy administrator acts',
    description:
      'The policy administrator carries out what the policy engine decided. It tells the policy enforcement point to open the session or to close it, and it issues any credentials for that session. The enforcement point then lets the traffic through, or blocks it, as instructed.',
  },
  {
    title: 'Control plane: adaptive identity',
    description:
      'Adaptive identity means that the proof required depends on the context of the request, not only on a password: who the user is, which device is used and whether it is healthy, the location, the time and how unusual the request is. When the risk looks higher, the policy engine can demand stronger proof or refuse.',
  },
  {
    title: 'Control plane: threat scope reduction',
    description:
      'Threat scope reduction limits how much damage one compromised account or device can do. CompTIA lists it under the control plane, because it is applied when access is decided: the policy engine grants each session the least access that it needs, to one resource and not to the whole network. An attacker who takes over the subject then reaches very little.',
  },
  {
    title: 'Data plane: implicit trust zone',
    description:
      'The implicit trust zone is the area behind the policy enforcement point. Whatever has passed the checkpoint is trusted inside it without being checked again, like passengers who are past airport security. Zero Trust keeps this zone as small as possible, ideally one resource.',
  },
];

function Drawing({ step }: { step: number }) {
  const at = (...steps: number[]): Emphasis => (steps.includes(step) ? 'on' : 'off');
  const from = (first: number): Emphasis => (step === first ? 'on' : step > first ? 'off' : 'hidden');
  return (
    <Canvas height={258}>
      {/* Everything that decides. Threat scope reduction belongs here, with the policy engine. */}
      <g data-plane="control">
        <rect x={4} y={6} width={312} height={108} rx={8} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
        <Label x={12} y={18} lines={['Control plane: decides']} size={10} anchor="start" tone="muted" />
        <Box x={22} y={50} w={96} h={40} lines={['Policy', 'engine']} state={at(2, 4, 5)} />
        <Box x={142} y={50} w={96} h={40} lines={['Policy', 'administrator']} state={at(3)} />
        <Arrow from={[118, 70]} to={[142, 70]} state={at(3)} />

        <Layer state={from(4)}>
          <Label x={12} y={31} lines={['user, device, place, time']} size={10} anchor="start" tone="accent" bold />
          <Arrow from={[70, 39]} to={[70, 50]} state="on" />
        </Layer>
        <Layer state={from(5)}>
          <Label x={12} y={102} lines={['least access per session']} size={10} anchor="start" tone="accent" bold />
        </Layer>
      </g>

      {/* The administrator instructs the enforcement point across the planes. */}
      <Arrow from={[190, 90]} to={[190, 164]} state={at(3)} />
      <Label x={196} y={122} lines={['open or close']} size={10} anchor="start" tone="muted" />

      <g data-plane="data">
        <rect x={4} y={130} width={312} height={122} rx={8} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
        <Label x={12} y={142} lines={['Data plane: enforces']} size={10} anchor="start" tone="muted" />

        <Layer state={from(6)}>
          <rect x={244} y={156} width={68} height={80} rx={6} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="5 3" />
          <Label x={278} y={213} lines={['Implicit', 'trust zone']} size={10} tone="accent" bold />
        </Layer>

        <Box x={10} y={164} w={72} h={40} lines={['Subject/', 'system']} state={at(1)} />
        <Box x={150} y={164} w={80} h={40} lines={['Enforcement', 'point (PEP)']} state={at(1, 3)} />
        <Box x={250} y={166} w={56} h={36} lines={['Resource']} state={at(1)} />
        <Arrow from={[82, 184]} to={[150, 184]} state={at(1)} />
        <Label x={116} y={175} lines={['request']} size={10} tone="muted" />
        <Arrow from={[230, 184]} to={[250, 184]} state={at(1)} />
      </g>
    </Canvas>
  );
}

export function ZeroTrustPlanes() {
  return <StepDiagram title="Zero Trust: control plane and data plane" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
