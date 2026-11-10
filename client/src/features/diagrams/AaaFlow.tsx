import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Four stages, always in this order',
    description:
      'Access control works in four stages: identify, authenticate, authorize, account. The last three are known as AAA. The same stages apply to a person signing in and to a device joining the network. The next steps follow Sam, who signs in to the VPN, and a laptop that connects to the office network.',
  },
  {
    title: 'Identify: claim an identity',
    description:
      'Identification is only a claim; nothing has been proved yet. A person: Sam types the username sam.lee. A device: the laptop presents its certificate, which names it LAPTOP-042.',
  },
  {
    title: 'Authenticate: prove the claim',
    description:
      'Authentication proves that the claim is true. A person: Sam gives a password and a one-time code from an authenticator app. A device: the laptop proves that it holds the private key that belongs to its certificate. People are usually authenticated with factors such as a password, a code or a fingerprint; systems are usually authenticated with a certificate.',
  },
  {
    title: 'Authorize: decide what is allowed',
    description:
      'Authorization decides what the authenticated identity may do. A person: Sam may open the finance share but not the HR share. A device: the laptop is placed on the staff network segment and cannot reach the server segment. Being authenticated does not mean being allowed to do everything.',
  },
  {
    title: 'Account: record what happened',
    description:
      'Accounting keeps a record of what each identity did. A person: when Sam signed in and which files Sam opened. A device: when the laptop connected and how much data it sent. These logs are the evidence used in audits and investigations.',
  },
  {
    title: 'The AAA server',
    description:
      'The checks are usually made in one central place, an AAA server, so that every door applies the same rules. The VPN gateway or network switch does not decide by itself: it passes the request to the AAA server using a protocol such as RADIUS or TACACS+, and enforces the answer.',
  },
];

const STAGES = ['Identify', 'Authenticate', 'Authorize', 'Account'] as const;

const ROWS: { person: string; device: string }[] = [
  { person: 'Sam signs in to the VPN', device: 'A laptop connects to the office network' },
  { person: 'Types the username sam.lee', device: 'Presents its certificate: LAPTOP-042' },
  { person: 'Password and a one-time code', device: 'Proves it holds the private key' },
  { person: 'Finance share: yes. HR share: no', device: 'Staff segment: yes. Servers: no' },
  { person: 'Logged: sign-in time, files opened', device: 'Logged: time connected, data sent' },
  { person: 'The VPN gateway asks the AAA server', device: 'The network switch asks the AAA server' },
];

const BOX_W = 70;
const GAP = 8;
const LEFT = 8;

function Drawing({ step }: { step: number }) {
  const current = step >= 1 && step <= 4 ? step - 1 : -1;
  const stage = (i: number): Emphasis => (current === -1 ? (step === 5 ? 'on' : 'off') : current === i ? 'on' : 'dim');
  const row = ROWS[step]!;
  return (
    <Canvas height={206}>
      {STAGES.map((name, i) => {
        const x = LEFT + i * (BOX_W + GAP);
        return (
          <g key={name}>
            <Box x={x} y={12} w={BOX_W} h={38} lines={[String(i + 1), name]} state={stage(i)} size={9.5} />
            {i > 0 && <Arrow from={[x - GAP, 31]} to={[x, 31]} state={current === i ? 'on' : 'off'} />}
          </g>
        );
      })}

      <Layer state={step === 5 ? 'on' : 'hidden'}>
        <line x1={LEFT} x2={LEFT + 4 * BOX_W + 3 * GAP} y1={58} y2={58} stroke="var(--accent)" strokeWidth={2} />
        <Label x={160} y={70} lines={['AAA server (RADIUS or TACACS+)']} size={10} tone="accent" bold />
      </Layer>

      {[
        { who: 'A person', text: row.person, y: 84 },
        { who: 'A device', text: row.device, y: 144 },
      ].map((lane) => (
        <g key={lane.who}>
          <rect x={LEFT} y={lane.y} width={4 * BOX_W + 3 * GAP} height={50} rx={6} fill="var(--bg)" stroke="var(--muted)" strokeWidth={1} />
          <Label x={LEFT + 10} y={lane.y + 16} lines={[lane.who]} size={9.5} anchor="start" tone="muted" />
          <Label x={LEFT + 10} y={lane.y + 34} lines={[lane.text]} size={11} anchor="start" />
        </g>
      ))}
    </Canvas>
  );
}

export function AaaFlow() {
  return <StepDiagram title="Identification and AAA" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
