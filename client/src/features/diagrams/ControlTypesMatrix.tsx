import { Canvas, Label, Layer } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const CATEGORIES = ['Technical', 'Managerial', 'Operational', 'Physical'] as const;

// `examples` follow the order of CATEGORIES: one per cell of the row.
const TYPES = [
  {
    name: 'Preventive',
    aim: 'stops an incident before it happens',
    examples: ['Firewall rule blocks unused ports', 'Manager approves access before it is granted', 'Help desk calls back before a password reset', 'Locked door on the server room'],
  },
  {
    name: 'Deterrent',
    aim: 'discourages an attempt',
    examples: ['Login message: misuse will be prosecuted', 'Policy states the penalties for misuse', 'Announced random bag checks at the exit', '"Video surveillance in use" sign'],
  },
  {
    name: 'Detective',
    aim: 'notices and reports an incident',
    examples: ['IDS raises an alert on unusual traffic', 'Access-rights audit reported to management', 'Analyst reviews the logs every day', 'Motion sensor in the server room'],
  },
  {
    name: 'Corrective',
    aim: 'limits damage and restores',
    examples: ['Restore lost files from a backup', 'Incident response plan guides recovery', 'Help desk rebuilds an infected laptop', 'Fire suppression system puts out a fire'],
  },
  {
    name: 'Compensating',
    aim: 'stands in for a control you cannot use',
    examples: ['Isolate a server that cannot be patched', 'Owner review where duties cannot be split', 'Staff sign people in while the reader is down', 'Keyed lock where no badge reader can be fitted'],
  },
  {
    name: 'Directive',
    aim: 'tells people what to do',
    examples: ['Pop-up tells users where to store files', 'Acceptable use policy', 'Security awareness training', '"All visitors must sign in" sign'],
  },
] as const;

const STEPS: DiagramStep[] = [
  {
    title: 'Two labels for every control',
    description:
      'Every security control can be described in two ways. Its category (the four columns) says how the control is put in place: by technology, by management decisions, by people following procedures, or by something physical. Its type (the six rows) says what the control does about an incident. The next steps go through the rows, with one example for every cell.',
  },
  {
    title: 'Preventive controls',
    description:
      'A preventive control stops an incident before it happens. Technical: a firewall rule blocks unused ports. Managerial: a manager must approve each request for access before it is granted. Operational: help-desk staff call a user back on a known number before resetting a password. Physical: a locked door on the server room.',
  },
  {
    title: 'Deterrent controls',
    description:
      'A deterrent control discourages an attempt but does not block it; the attacker can still choose to go ahead. Technical: a login message warns that unauthorized use will be prosecuted. Managerial: a policy states the penalties for misuse (it warns of consequences; it does not give an instruction). Operational: staff carry out random bag checks at the exit, and everyone is told in advance that they happen. Physical: a sign says that video surveillance is in use.',
  },
  {
    title: 'Detective controls',
    description:
      'A detective control notices and reports an incident while it happens or afterwards; it does not stop it. Technical: an intrusion detection system (IDS) raises an alert on unusual traffic. Managerial: a scheduled audit of access rights, with its findings reported to management. Operational: an analyst reviews the logs every day. Physical: a motion sensor in the server room.',
  },
  {
    title: 'Corrective controls',
    description:
      'A corrective control acts after an incident to limit the damage and return things to normal. Technical: lost files are restored from a backup. Managerial: an incident response plan guides the recovery. Operational: the help desk rebuilds an infected laptop. Physical: a fire suppression system puts out a fire.',
  },
  {
    title: 'Compensating controls',
    description:
      'A compensating control stands in when the usual control cannot be used, and gives similar protection in another way. Technical: a server that cannot be patched is isolated on its own network segment. Managerial: a firm with one bookkeeper cannot separate duties, so the owner checks the bank statement against the invoices every week. Operational: reception staff sign people in by hand while the badge reader is out of order. Physical: a keyed lock protects a cabinet where a badge reader cannot be fitted.',
  },
  {
    title: 'Directive controls',
    description:
      'A directive control tells people what to do, and depends on them following it. Technical: a pop-up tells users where to store sensitive files. Managerial: an acceptable use policy. Operational: security awareness training. Physical: a sign that says "All visitors must sign in at reception". One control can fit more than one type: a camera both deters and detects.',
  },
];

const LEFT = 2;
const HEAD_W = 78;
const COL_W = 59.5;
const TOP = 8;
const HEAD_H = 20;
const ROW_H = 17;
const GRID_W = HEAD_W + COL_W * CATEGORIES.length;
const GRID_H = HEAD_H + ROW_H * TYPES.length;
const PANEL = TOP + GRID_H + 20;

function Drawing({ step }: { step: number }) {
  const row = step - 1; // -1 on the overview step
  const type = TYPES[row];
  return (
    <Canvas height={PANEL + 86}>
      {CATEGORIES.map((name, c) => (
        <Label key={name} x={LEFT + HEAD_W + COL_W * c + COL_W / 2} y={TOP + HEAD_H / 2} lines={[name]} size={10} />
      ))}
      {TYPES.map((t, r) => (
        <Layer key={t.name} state={row === -1 || row === r ? 'off' : 'dim'}>
          <Label x={LEFT + 4} y={TOP + HEAD_H + ROW_H * r + ROW_H / 2} lines={[t.name]} size={10} anchor="start" />
        </Layer>
      ))}
      {/* Grid lines */}
      <rect x={LEFT} y={TOP} width={GRID_W} height={GRID_H} rx={4} fill="none" stroke="var(--muted)" strokeWidth={1} />
      {TYPES.map((t, r) => (
        <line key={t.name} x1={LEFT} x2={LEFT + GRID_W} y1={TOP + HEAD_H + ROW_H * r} y2={TOP + HEAD_H + ROW_H * r} stroke="var(--muted)" strokeWidth={0.75} />
      ))}
      {CATEGORIES.map((name, c) => (
        <line key={name} x1={LEFT + HEAD_W + COL_W * c} x2={LEFT + HEAD_W + COL_W * c} y1={TOP} y2={TOP + GRID_H} stroke="var(--muted)" strokeWidth={0.75} />
      ))}

      {/* Overview: the two header strips. */}
      <Layer state={row === -1 ? 'on' : 'hidden'}>
        <rect x={LEFT + HEAD_W} y={TOP} width={GRID_W - HEAD_W} height={HEAD_H} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        <rect x={LEFT} y={TOP + HEAD_H} width={HEAD_W} height={GRID_H - HEAD_H} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      </Layer>
      {/* The highlighted row slides from one type to the next. */}
      <Layer state={row === -1 ? 'hidden' : 'on'}>
        <g className="transition-transform duration-300 ease-out" style={{ transform: `translateY(${Math.max(row, 0) * ROW_H}px)` }}>
          <rect x={LEFT} y={TOP + HEAD_H} width={GRID_W} height={ROW_H} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
          {CATEGORIES.map((name, c) => (
            <circle key={name} cx={LEFT + HEAD_W + COL_W * c + COL_W / 2} cy={TOP + HEAD_H + ROW_H / 2} r={3} fill="var(--accent)" stroke="none" />
          ))}
        </g>
      </Layer>

      {type ? (
        <>
          <Label x={LEFT + 2} y={PANEL} lines={[`${type.name}: ${type.aim}`]} size={10.5} anchor="start" tone="accent" bold />
          {CATEGORIES.map((name, c) => (
            <g key={name}>
              <Label x={LEFT + 2} y={PANEL + 19 + c * 17} lines={[name]} size={10} anchor="start" tone="muted" />
              <Label x={LEFT + 66} y={PANEL + 19 + c * 17} lines={[type.examples[c]!]} size={10} anchor="start" />
            </g>
          ))}
        </>
      ) : (
        <>
          <Label x={LEFT + 2} y={PANEL} lines={['Every control has both']} size={10.5} anchor="start" tone="accent" bold />
          <Label x={LEFT + 2} y={PANEL + 19} lines={['Category (columns): how it is put in place']} size={10} anchor="start" />
          <Label x={LEFT + 2} y={PANEL + 36} lines={['Type (rows): what it does about an incident']} size={10} anchor="start" />
        </>
      )}
    </Canvas>
  );
}

export function ControlTypesMatrix() {
  return <StepDiagram title="Control categories and types" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
