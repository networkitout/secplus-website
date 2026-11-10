import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Symmetric: one shared key',
    description:
      'In symmetric encryption the same secret key encrypts and decrypts. Alice and Bob must both hold that key and keep it secret. Symmetric algorithms such as AES are fast, so they are used for large amounts of data.',
  },
  {
    title: 'The key-exchange problem',
    description:
      'How does Bob get the shared key in the first place? If Alice sends it over the same network, Eve, who is listening, gets a copy and can read everything that follows. The key would have to travel by some other, already secure route. The number of keys also grows quickly: every pair of people needs its own.',
  },
  {
    title: 'Asymmetric: a key pair',
    description:
      'In asymmetric encryption each person has two keys that belong together. The public key can be given to anyone. The private key never leaves its owner. What one key of the pair locks, only the other key of the same pair can unlock. Here Bob keeps his private key and sends Alice his public key; it does not matter that Eve sees it.',
  },
  {
    title: "Encrypt with the recipient's public key",
    description:
      "To send Bob a confidential message, Alice encrypts it with Bob's public key. Only Bob's private key can decrypt it, and only Bob has that. Eve holds the public key too, but a public key cannot undo its own encryption. Asymmetric algorithms such as RSA and ECC solve the key-exchange problem, but they are much slower than symmetric ones.",
  },
  {
    title: 'Hybrid, part 1: agree on a session key',
    description:
      'Real systems combine both kinds. First, asymmetric cryptography is used once, at the start, so that Alice and Bob end up with the same new symmetric key without Eve learning it. This short-lived key is called a session key.',
  },
  {
    title: 'Hybrid, part 2: symmetric for the data',
    description:
      'From then on, all the data is encrypted with the session key using a fast symmetric algorithm. This is how TLS protects web traffic: the slow asymmetric step solves the key-exchange problem, and the fast symmetric step does the bulk of the work.',
  },
];

type Scene = {
  alice: string[];
  bob: string[];
  wire: string;
  /** Which way the message on the wire travels. */
  flow: 'right' | 'left' | 'both';
  eve: string;
  note: string;
};

const SCENES: Scene[] = [
  { alice: ['shared key'], bob: ['shared key'], wire: 'ciphertext', flow: 'right', eve: '', note: 'The same key locks and unlocks' },
  { alice: ['shared key'], bob: ['no key yet'], wire: 'the key itself?', flow: 'right', eve: 'copies the key', note: 'Sending the key lets Eve copy it' },
  { alice: ["Bob's public key"], bob: ['private key', '+ public key'], wire: "Bob's public key", flow: 'left', eve: 'sees it: harmless', note: 'The public key may be seen by anyone' },
  { alice: ['encrypts with', "Bob's public key"], bob: ['decrypts with', 'his private key'], wire: 'ciphertext', flow: 'right', eve: 'cannot decrypt', note: 'Only the private key of the pair decrypts' },
  { alice: ['session key'], bob: ['session key'], wire: 'key exchange', flow: 'both', eve: 'learns nothing', note: 'Asymmetric step: once, at the start' },
  { alice: ['session key'], bob: ['session key'], wire: 'bulk data', flow: 'both', eve: 'cannot decrypt', note: 'Symmetric step: fast, for all the data' },
];

/** A simple key: bow, shaft and two teeth. */
function Key({ x, y, state }: { x: number; y: number; state: Emphasis }) {
  return (
    <Layer state={state}>
      <g fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinecap="round">
        <circle cx={x} cy={y} r={5} />
        <path d={`M ${x + 5} ${y} H ${x + 21} M ${x + 15} ${y} V ${y + 5} M ${x + 20} ${y} V ${y + 4}`} />
      </g>
    </Layer>
  );
}

function Drawing({ step }: { step: number }) {
  const scene = SCENES[step]!;
  const wireY = 44;
  return (
    <Canvas height={214}>
      <Box x={8} y={24} w={72} h={40} lines={['Alice']} size={11} />
      <Box x={240} y={24} w={72} h={40} lines={['Bob']} size={11} />

      <Label x={160} y={32} lines={[scene.wire]} size={10} bold />
      <Arrow
        from={scene.flow === 'left' ? [240, wireY] : [80, wireY]}
        to={scene.flow === 'left' ? [80, wireY] : [240, wireY]}
        both={scene.flow === 'both'}
        state="on"
      />

      {[
        { x: 44, lines: scene.alice, key: true },
        { x: 276, lines: scene.bob, key: step !== 1 },
      ].map((side) => (
        <g key={side.x}>
          <Key x={side.x - 10} y={82} state={side.key ? 'on' : 'hidden'} />
          <Label x={side.x} y={100} lines={side.lines} size={9.5} />
        </g>
      ))}

      <Layer state={scene.eve ? (step === 1 ? 'on' : 'off') : 'hidden'}>
        <line x1={160} x2={160} y1={wireY} y2={118} stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="3 3" />
      </Layer>
      <Box x={112} y={118} w={96} h={40} lines={scene.eve ? ['Eve', scene.eve] : ['Eve']} size={9.5} state={scene.eve ? (step === 1 ? 'on' : 'off') : 'hidden'} />

      <rect x={8} y={176} width={304} height={28} rx={6} fill="var(--bg)" stroke="var(--muted)" strokeWidth={1} />
      <Label x={160} y={190} lines={[scene.note]} size={10.5} bold />
    </Canvas>
  );
}

export function SymmetricVsAsymmetric() {
  return <StepDiagram title="Symmetric and asymmetric encryption" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
