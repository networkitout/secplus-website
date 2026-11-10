import { Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'The CIA triad',
    description:
      'Information security has three goals: confidentiality, integrity and availability. Every control you will study protects at least one of them, and every attack harms at least one of them.',
  },
  {
    title: 'Confidentiality',
    description:
      'Confidentiality means that only authorized people and systems can read the data. A payroll file that anyone on the network can open has lost its confidentiality, even if nobody changed it.',
  },
  {
    title: 'Integrity',
    description:
      'Integrity means that the data is accurate and has not been changed without authorization, and that any change can be detected. A bank transfer whose amount was altered on the way has lost its integrity.',
  },
  {
    title: 'Availability',
    description:
      'Availability means that systems and data are there when authorized users need them. A web shop that is unreachable during a sale has lost its availability, even though no data was read or changed.',
  },
  {
    title: 'One attack on each goal',
    description:
      'Confidentiality: eavesdropping, where an attacker captures unencrypted traffic and reads it. Integrity: tampering, where an attacker changes a record or a message in transit. Availability: a denial-of-service (DoS) attack, where a flood of junk traffic leaves no capacity for real users.',
  },
  {
    title: 'One control for each goal',
    description:
      'Confidentiality: encryption, so that captured data cannot be read without the key. Integrity: hashing, so that any change to the data produces a different hash, which shows up when the hashes are compared. Availability: redundancy, such as a second server or site that takes over when the first one fails.',
  },
];

const CORNERS = [
  { name: 'Confidentiality', x: 160, box: 8, text: 48, attack: 'Attack: eavesdropping', control: 'Control: encryption', means: ['Only authorized', 'eyes can read it'] },
  { name: 'Integrity', x: 62, box: 196, text: 236, attack: 'Attack: tampering', control: 'Control: hashing', means: ['Accurate and', 'unaltered'] },
  { name: 'Availability', x: 258, box: 196, text: 236, attack: 'Attack: DoS flood', control: 'Control: redundancy', means: ['There when it', 'is needed'] },
] as const;

function Drawing({ step }: { step: number }) {
  const focus = step >= 1 && step <= 3 ? step - 1 : -1;
  const state = (i: number): Emphasis => (focus === -1 ? (step === 0 ? 'off' : 'on') : focus === i ? 'on' : 'dim');
  const centre = focus === -1 ? (step === 0 ? ['Three goals', 'of security'] : step === 4 ? ['What can', 'go wrong'] : ['What', 'protects it']) : CORNERS[focus]!.means;
  return (
    <Canvas height={264}>
      <polygon points="160,78 84,188 236,188" fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" />
      <Label x={160} y={148} lines={centre} size={10} tone="muted" />
      {CORNERS.map((c, i) => (
        <g key={c.name}>
          <Box x={c.x - 54} y={c.box} w={108} h={28} lines={[c.name]} state={state(i)} size={11} />
          <Layer state={step >= 4 ? 'off' : 'hidden'}>
            <Label x={c.x} y={c.text} lines={[c.attack]} size={10} />
          </Layer>
          <Layer state={step >= 5 ? 'off' : 'hidden'}>
            <Label x={c.x} y={c.text + 13} lines={[c.control]} size={10} tone="accent" bold />
          </Layer>
        </g>
      ))}
    </Canvas>
  );
}

export function CiaTriad() {
  return <StepDiagram title="The CIA triad" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
