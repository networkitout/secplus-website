import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Four stages, always in this order',
    description:
      'Access control works in four stages: identification, authentication, authorization, accounting. The last three are known as AAA. The same stages apply to a person signing in and to a device joining the network. The next steps follow Sam, who signs in to the VPN, and a laptop that joins the office Wi-Fi.',
  },
  {
    title: 'Identification: claim an identity',
    description:
      'Identification is only a claim; nothing has been proved yet. A person: Sam types the username sam.lee. A device: the laptop presents its certificate, which names it LAPTOP-042.',
  },
  {
    title: 'Authentication: prove the claim',
    description:
      'Authentication proves that the claim is true. A person: Sam gives a password and a one-time code from an authenticator app. A device: the laptop proves that it holds the private key that belongs to its certificate. People are usually authenticated with factors such as a password, a code or a fingerprint; systems are usually authenticated with a certificate.',
  },
  {
    title: 'Authorization: decide what is allowed',
    description:
      'Authorization decides what the authenticated identity may do. A person: Sam may open the finance share but not the HR share. A device: the laptop is placed on the staff network segment and cannot reach the server segment. Being authenticated does not mean being allowed to do everything.',
  },
  {
    title: 'Accounting: record what happened',
    description:
      'Accounting keeps a record of what each identity did. A person: when Sam signed in and which files Sam opened. A device: when the laptop connected and how much data it sent. These logs are the evidence used in audits and investigations.',
  },
  {
    title: 'The AAA server',
    description:
      'The checks are often made in one central place, an AAA server, so that every door applies the same rules. The VPN gateway or Wi-Fi access point does not decide by itself: it passes the request to the AAA server using a protocol such as RADIUS, and enforces the answer.',
  },
];

const STAGES = ['Identification', 'Authentication', 'Authorization', 'Accounting'] as const;

const ROWS: { person: string; device: string }[] = [
  { person: 'Sam signs in to the VPN', device: 'A laptop joins the office Wi-Fi' },
  { person: 'Types the username sam.lee', device: 'Presents its certificate: LAPTOP-042' },
  { person: 'Password and a one-time code', device: 'Proves it holds the private key' },
  { person: 'Finance share: yes. HR share: no', device: 'Staff segment: yes. Servers: no' },
  { person: 'Logged: sign-in time, files opened', device: 'Logged: time connected, data sent' },
  { person: 'The VPN gateway asks the AAA server', device: 'The Wi-Fi access point asks the AAA server' },
];

// The stages are laid out two by two, read like text: 1 2 on the first row, 3 4 on the second.
const LEFT = 8;
const BOX_W = 146;
const BOX_H = 26;
const GAP = 12;
const TOP = 10;
const ROW_GAP = 12;
const RIGHT = LEFT + 2 * BOX_W + GAP;

const corner = (i: number) => ({ x: LEFT + (i % 2) * (BOX_W + GAP), y: TOP + Math.floor(i / 2) * (BOX_H + ROW_GAP) });

function Drawing({ step }: { step: number }) {
  const current = step >= 1 && step <= 4 ? step - 1 : -1;
  const stage = (i: number): Emphasis => (current === -1 ? (step === 5 ? 'on' : 'off') : current === i ? 'on' : 'dim');
  const into = (i: number): Emphasis => (current === i ? 'on' : 'off');
  const row = ROWS[step]!;
  const second = TOP + BOX_H + ROW_GAP;
  const turn = TOP + BOX_H + ROW_GAP / 2;
  return (
    <Canvas height={226}>
      {STAGES.map((name, i) => {
        const { x, y } = corner(i);
        return <Box key={name} x={x} y={y} w={BOX_W} h={BOX_H} lines={[`${i + 1} ${name}`]} state={stage(i)} size={10.5} />;
      })}
      <Arrow from={[LEFT + BOX_W, TOP + BOX_H / 2]} to={[LEFT + BOX_W + GAP, TOP + BOX_H / 2]} state={into(1)} />
      <Arrow from={[LEFT + BOX_W, second + BOX_H / 2]} to={[LEFT + BOX_W + GAP, second + BOX_H / 2]} state={into(3)} />
      {/* From stage 2 down and back to the start of the second row. */}
      <Layer state={into(2)}>
        <path
          d={`M ${RIGHT - BOX_W / 2} ${TOP + BOX_H} V ${turn} H ${LEFT + BOX_W / 2}`}
          fill="none"
          stroke={current === 2 ? 'var(--accent)' : 'var(--muted)'}
          strokeWidth={current === 2 ? 2 : 1.25}
        />
      </Layer>
      <Arrow from={[LEFT + BOX_W / 2, turn]} to={[LEFT + BOX_W / 2, second]} state={into(2)} />

      <Layer state={step === 5 ? 'on' : 'hidden'}>
        <line x1={LEFT} x2={RIGHT} y1={second + BOX_H + 8} y2={second + BOX_H + 8} stroke="var(--accent)" strokeWidth={2} />
        <Label x={160} y={second + BOX_H + 20} lines={['AAA server (for example RADIUS)']} size={10} tone="accent" bold />
      </Layer>

      {[
        { who: 'A person', text: row.person, y: 108 },
        { who: 'A device', text: row.device, y: 166 },
      ].map((lane) => (
        <g key={lane.who}>
          <rect x={LEFT} y={lane.y} width={RIGHT - LEFT} height={50} rx={6} fill="var(--bg)" stroke="var(--muted)" strokeWidth={1} />
          <Label x={LEFT + 10} y={lane.y + 16} lines={[lane.who]} size={10} anchor="start" tone="muted" />
          <Label x={LEFT + 10} y={lane.y + 34} lines={[lane.text]} size={11} anchor="start" />
        </g>
      ))}
    </Canvas>
  );
}

export function AaaFlow() {
  return <StepDiagram title="Identification and AAA" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
