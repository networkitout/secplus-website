import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Never trust, always verify',
    description:
      'In a zero trust architecture nothing is trusted because of where it is on the network. Every request to reach a resource is checked. The work is split into two planes: the control plane decides who may have access, and the data plane carries the traffic and enforces the decision.',
  },
  {
    title: 'Data plane: subject, enforcement point, resource',
    description:
      'A subject is whatever asks for access: a user, a device or an application. Its request does not go straight to the resource. It first meets the policy enforcement point (PEP), the gatekeeper that sits in the path and allows, monitors or ends the connection.',
  },
  {
    title: 'Control plane: the policy engine decides',
    description:
      "The policy engine makes the decision to grant, deny or revoke access. It compares the request with the organization's policy and with what it knows about the subject. This is policy-driven access control: the rules decide, not the network location.",
  },
  {
    title: 'Control plane: the policy administrator acts',
    description:
      'The policy administrator carries out what the policy engine decided. It tells the policy enforcement point to open the session or to shut it, and it issues the credentials or tokens for that session. Together, the policy engine and the policy administrator form the policy decision point.',
  },
  {
    title: 'Adaptive identity',
    description:
      'Adaptive identity means that the check uses context, not only a password: who the user is, which device is used and whether it is healthy, the location, the time and how unusual the request is. When the risk looks higher, the policy engine can demand stronger proof or refuse.',
  },
  {
    title: 'Threat scope reduction',
    description:
      'Threat scope reduction limits how much damage one compromised account or device can do. Each session gets the least access that it needs, to one resource and not to the whole network, so an attacker who takes over the subject reaches very little.',
  },
  {
    title: 'Implicit trust zone',
    description:
      'The implicit trust zone is the area behind the policy enforcement point. Whatever has passed the checkpoint is trusted inside it without being checked again, like passengers who are past airport security. Zero trust keeps this zone as small as possible, ideally one resource.',
  },
];

function Drawing({ step }: { step: number }) {
  const at = (...steps: number[]): Emphasis => (steps.includes(step) ? 'on' : 'off');
  const from = (first: number): Emphasis => (step === first ? 'on' : step > first ? 'off' : 'hidden');
  return (
    <Canvas height={252}>
      {/* Control plane */}
      <rect x={4} y={6} width={312} height={100} rx={8} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
      <Label x={12} y={18} lines={['Control plane: decides']} size={9.5} anchor="start" tone="muted" />
      <Box x={22} y={50} w={96} h={40} lines={['Policy', 'engine']} state={at(2, 4)} />
      <Box x={142} y={50} w={96} h={40} lines={['Policy', 'administrator']} state={at(3)} />
      <Arrow from={[118, 70]} to={[142, 70]} state={at(3)} />

      <Layer state={from(4)}>
        <Label x={70} y={32} lines={['user, device, place, time']} size={9} tone="accent" bold />
        <Arrow from={[70, 39]} to={[70, 50]} state="on" />
      </Layer>

      {/* The administrator instructs the enforcement point across the planes. */}
      <Arrow from={[190, 90]} to={[190, 156]} state={at(3)} />
      <Label x={196} y={114} lines={['open or shut']} size={9} anchor="start" tone="muted" />

      {/* Data plane */}
      <rect x={4} y={122} width={312} height={124} rx={8} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
      <Label x={12} y={134} lines={['Data plane: enforces']} size={9.5} anchor="start" tone="muted" />

      <Layer state={from(6)}>
        <rect x={244} y={148} width={68} height={78} rx={6} fill="none" stroke="var(--accent)" strokeWidth={step === 6 ? 2.5 : 1.25} strokeDasharray="5 3" />
        <Label x={278} y={204} lines={['Implicit', 'trust zone']} size={9} tone="accent" bold />
      </Layer>

      <Box x={10} y={158} w={72} h={36} lines={['Subject']} state={at(1)} />
      <Box x={150} y={156} w={80} h={40} lines={['Enforcement', 'point (PEP)']} state={at(1, 3)} />
      <Box x={250} y={156} w={56} h={36} lines={['Resource']} state={at(1, 5)} size={9.5} />
      <Arrow from={[82, 176]} to={[150, 176]} state={at(1)} />
      <Label x={116} y={167} lines={['request']} size={9} tone="muted" />
      <Arrow from={[230, 176]} to={[250, 176]} state={at(1, 5)} />

      <Layer state={from(5)}>
        <Label x={12} y={232} lines={['Least access: one resource per session']} size={9.5} anchor="start" tone="accent" bold />
      </Layer>
    </Canvas>
  );
}

export function ZeroTrustPlanes() {
  return <StepDiagram title="Zero trust: control plane and data plane" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
