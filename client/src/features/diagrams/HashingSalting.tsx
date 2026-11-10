import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'A hash is one-way',
    description:
      'A hash function turns input of any length into a fixed-length value called a hash or digest. SHA-256 always produces 256 bits. It is not encryption: there is no key, and there is no practical way to turn the digest back into the input. A system can therefore store the hash of a password instead of the password.',
  },
  {
    title: 'Same input, same hash',
    description:
      'The same input always gives the same hash, which is how a login is checked: hash what the user typed and compare it with the stored hash. Change one character and the hash is completely different. But notice the weakness: Ana and Ben chose the same password, so their stored hashes are identical.',
  },
  {
    title: 'Rainbow table attack',
    description:
      'An attacker who steals the stored hashes does not need to reverse them. A rainbow table is a precomputed table that maps the hashes of very many likely passwords back to those passwords. Looking up a stolen hash takes moments, and one match reveals the password of every user with that hash.',
  },
  {
    title: 'Salting',
    description:
      'A salt is a unique random value, generated for each password, that is added to the password before hashing and stored next to the hash. Ana and Ben now have different hashes for the same password. A precomputed table is useless, because it was not built with these salts. The salt does not need to be secret.',
  },
  {
    title: 'Key stretching',
    description:
      'A salt does not stop an attacker from guessing passwords one at a time for a single user. Key stretching makes every guess expensive, for example by running the hash many thousands of times. Functions such as bcrypt, PBKDF2, scrypt and Argon2 do this, and they include the salt. A login waits a fraction of a second; an attacker with billions of guesses waits years.',
  },
];

// Real SHA-256 digests, shortened to their first four and last four hex digits.
const PLAIN = 'a5c9…f9b8'; // "Summer2026!"
const CHANGED = '74b3…81bc'; // "Summer2026?"
const SALTED_ANA = '6308…82e3'; // "k9Qz" + "Summer2026!"
const SALTED_BEN = 'd376…9ce0'; // "T4mw" + "Summer2026!"

type Row = { who: string; input: string; stored: string; state: Emphasis };

function rows(step: number): Row[] {
  const salted = step >= 3;
  return [
    { who: 'Ana', input: salted ? 'k9Qz+Summer2026!' : 'Summer2026!', stored: salted ? `k9Qz : ${SALTED_ANA}` : PLAIN, state: 'off' },
    { who: 'Ben', input: salted ? 'T4mw+Summer2026!' : 'Summer2026!', stored: salted ? `T4mw : ${SALTED_BEN}` : PLAIN, state: step === 0 ? 'hidden' : 'off' },
    { who: '', input: 'Summer2026?', stored: CHANGED, state: step === 1 ? 'off' : 'hidden' },
  ];
}

const NOTES: string[][] = [
  ['No way back: the digest cannot be', 'turned into the password again'],
  ['Same password, same hash.', 'One character changed: a different hash'],
  [`Table lookup: ${PLAIN} = Summer2026!`, 'Both accounts are broken at once'],
  ['Different salts, different hashes.', 'The precomputed table has no match'],
  ['Deliberately expensive to compute:', 'each guess is slow (bcrypt, PBKDF2, scrypt, Argon2)'],
];

function Drawing({ step }: { step: number }) {
  return (
    <Canvas height={192}>
      <Label x={28} y={12} lines={['input']} size={10} anchor="start" tone="muted" />
      <Label x={316} y={12} lines={[step >= 3 ? 'stored salt + hash' : 'stored hash']} size={10} anchor="end" tone="muted" />
      {rows(step).map((row, i) => {
        const y = 24 + i * 34;
        return (
          <Layer key={i} state={row.state}>
            <Label x={4} y={y + 12} lines={[row.who]} size={10} anchor="start" tone="muted" />
            <Label x={28} y={y + 12} lines={[row.input]} size={10} anchor="start" mono />
            <Arrow from={[128, y + 12]} to={[140, y + 12]} />
            <Box x={140} y={y} w={60} h={24} lines={[step === 4 ? 'slow hash' : 'hash']} size={10} bold={false} state={step === 4 ? 'on' : 'off'} />
            <Arrow from={[200, y + 12]} to={[212, y + 12]} />
            <Label x={316} y={y + 12} lines={[row.stored]} size={10} anchor="end" mono bold={step === 1 || step === 2 || step === 3} />
          </Layer>
        );
      })}

      <rect x={8} y={138} width={304} height={44} rx={6} fill="var(--bg)" stroke={step === 2 ? 'var(--accent)' : 'var(--muted)'} strokeWidth={step === 2 ? 2.5 : 1} />
      <Label x={160} y={153} lines={NOTES[step]!} size={10} />
    </Canvas>
  );
}

export function HashingSalting() {
  return <StepDiagram title="Hashing, salting and key stretching" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
