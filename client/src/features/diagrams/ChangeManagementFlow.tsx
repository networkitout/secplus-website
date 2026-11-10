import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STAGES: { name: string; notes: string[] }[] = [
  { name: 'Request', notes: ['What, why and when', 'Systems affected', 'A named owner'] },
  { name: 'Impact analysis', notes: ['Dependencies', 'Downtime needed', 'Risk if it fails'] },
  { name: 'Test', notes: ['Tried away from', 'production', 'Results recorded'] },
  { name: 'Approval', notes: ['Decided by others,', 'using the analysis', 'and the test results'] },
  { name: 'Maintenance window', notes: ['A quiet, agreed time', 'Proposed in the request', 'Stakeholders told'] },
  { name: 'Implement', notes: ['Only what was', 'approved', 'Restarts as planned'] },
  { name: 'Verify or back out', notes: ['Works: carry on', 'Fails: backout plan', 'to the last good state'] },
  { name: 'Update documentation', notes: ['Diagrams', 'Procedures', 'Change record closed'] },
];

const STEPS: DiagramStep[] = [
  {
    title: 'Request',
    description:
      'A change starts as a written request: what will change, why, which systems it touches and when it is proposed to happen. The request names an owner, the person or team responsible for the change from start to finish, and lists the stakeholders who are affected by it.',
  },
  {
    title: 'Impact analysis',
    description:
      'Before anyone decides, the change is analyzed. Which other systems and applications depend on this one? How much downtime is needed? Will a service or application have to restart? What is the risk if it goes wrong, and what is the risk of not making the change?',
  },
  {
    title: 'Test',
    description:
      'The change is tried in a test environment that resembles production, and the test results are kept, because the approvers will want to see them. The backout plan, the way to undo the change, is written and tested here too: an untested backout plan cannot be relied on.',
  },
  {
    title: 'Approval',
    description:
      'The request, the impact analysis and the test results go through the approval process, often a change advisory board. People other than the requester approve the change, reject it or ask for more detail. Nothing is changed in production before approval. Some organizations approve the change first and then test it before go-live.',
  },
  {
    title: 'Maintenance window',
    description:
      'The change is made in a maintenance window: an agreed period, usually when the business is quiet, in which downtime is acceptable. The window is proposed in the request and approved with it. Stakeholders are told in advance when it will happen and what they will notice.',
  },
  {
    title: 'Implement',
    description:
      'During the window the change is made by following the approved plan and the standard operating procedure, step by step. Only what was approved is changed; an extra improvement added on the spot is an unapproved change.',
  },
  {
    title: 'Verify or back out',
    description:
      'After the change, check that the system works and that the systems that depend on it still work. If it does not, use the backout plan to return to the last known good state before the window ends, then go back to analysis with what was learned.',
  },
  {
    title: 'Update documentation',
    description:
      'A change is finished only when the records match reality: network diagrams, policies and procedures are updated, the new version is recorded in version control, and the change record is closed with its outcome.',
  },
];

const X = 14;
const BOX_W = 166;
const BOX_H = 22;
const PITCH = 30;
const TOP = 8;
const NOTES_X = X + BOX_W + 16;
const LINE = 9.5 * 1.25;

const middle = (i: number) => TOP + i * PITCH + BOX_H / 2;

function Drawing({ step }: { step: number }) {
  const state = (i: number): Emphasis => (i === step ? 'on' : 'off');
  const notes = STAGES[step]!.notes;
  return (
    <Canvas height={TOP * 2 + PITCH * (STAGES.length - 1) + BOX_H}>
      {STAGES.map((stage, i) => {
        const y = TOP + i * PITCH;
        return (
          <g key={stage.name}>
            {i > 0 && <Arrow from={[X + 12, y - (PITCH - BOX_H)]} to={[X + 12, y]} state={state(i)} />}
            <Box x={X} y={y} w={BOX_W} h={BOX_H} lines={[]} state={state(i)} />
            {/* A stage that is behind the current one is ticked. */}
            <Label x={X + 12} y={middle(i)} lines={[i < step ? '✓' : String(i + 1)]} size={10} tone={i === step ? 'accent' : 'muted'} bold />
            <Label x={X + 26} y={middle(i)} lines={[stage.name]} size={10.5} anchor="start" bold={i === step} />
          </g>
        );
      })}

      {/* Notes for the current stage slide down beside its box. */}
      <g className="transition-transform duration-300 ease-out" style={{ transform: `translateY(${middle(step)}px)` }}>
        <line x1={X + BOX_W} x2={NOTES_X - 4} y1={0} y2={0} stroke="var(--accent)" strokeWidth={1.25} />
        <Label x={NOTES_X} y={(-(notes.length - 1) * LINE) / 2} lines={notes} size={9.5} anchor="start" />
      </g>

      {/* A failed change is backed out and returns to analysis. */}
      <Layer state={step === 6 ? 'on' : 'hidden'}>
        <path d={`M ${X} ${middle(6)} H 5 V ${middle(1)} H ${X - 5}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
        <polygon points={`${X},${middle(1)} ${X - 6},${middle(1) - 3} ${X - 6},${middle(1) + 3}`} fill="var(--accent)" stroke="none" />
      </Layer>
    </Canvas>
  );
}

export function ChangeManagementFlow() {
  return <StepDiagram title="Change management, start to finish" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
