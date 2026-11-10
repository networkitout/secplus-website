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
      'A salt is a unique random value, generated for each password, that is added to the password before hashing and stored next to the hash. In the picture the salt is put directly in front of the password. Ana and Ben now have different hashes for the same password. A precomputed table is useless, because it was not built with these salts. The salt does not need to be secret.',
  },
  {
    title: 'Key stretching',
    description:
      'A salt does not stop an attacker from guessing passwords one at a time for a single user. Key stretching makes every guess expensive, for example by running the hash many thousands of times. Functions such as bcrypt, PBKDF2, scrypt and Argon2 do this, and they include the salt. The picture uses PBKDF2 with 600,000 rounds, which takes the password and the salt as two separate inputs. A login waits a fraction of a second; an attacker with billions of guesses waits years.',
  },
];

// Every stored value is real and can be reproduced from exactly what its row displays; each is shortened
// to its first four and last four hex digits.
// - Up to the salting step: SHA-256 of the input as drawn, UTF-8. With a salt, the input is the four salt
//   characters directly followed by the password, with nothing in between.
// - Key-stretching step: PBKDF2-HMAC-SHA256, 600,000 iterations, 32-byte output, with the password and the
//   salt as its two separate inputs (Node: crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256')).
const PASSWORD = 'Summer2026!';
const CHANGED = 'Summer2026?';
const SHA256: Record<string, string> = { [PASSWORD]: 'a5c9…f9b8', [CHANGED]: '74b3…81bc', [`k9Qz${PASSWORD}`]: '6308…82e3', [`T4mw${PASSWORD}`]: 'd376…9ce0' };
const PBKDF2: Record<string, string> = { k9Qz: '8470…6e34', T4mw: 'ffb3…8116' };

type Row = { who: string; salt: string; password: string; stored: string; state: Emphasis };

function rows(step: number): Row[] {
  const salted = step >= 3;
  const stretched = step === 4;
  const user = (who: string, salt: string, state: Emphasis): Row => ({
    who,
    salt: salted ? salt : '',
    password: PASSWORD,
    stored: stretched ? `${salt} : ${PBKDF2[salt]}` : salted ? `${salt} : ${SHA256[salt + PASSWORD]}` : SHA256[PASSWORD]!,
    state,
  });
  return [
    user('Ana', 'k9Qz', 'off'),
    user('Ben', 'T4mw', step === 0 ? 'hidden' : 'off'),
    { who: '', salt: '', password: CHANGED, stored: SHA256[CHANGED]!, state: step === 1 ? 'off' : 'hidden' },
  ];
}

const NOTES: string[][] = [
  ['No way back: the digest cannot be', 'turned into the password again'],
  ['Same password, same hash.', 'One character changed: a different hash'],
  [`Table lookup: ${SHA256[PASSWORD]} = ${PASSWORD}`, 'Both accounts are broken at once'],
  ['Different salts, different hashes.', 'The precomputed table has no match'],
  ['Deliberately expensive to compute:', 'each guess is slow (bcrypt, PBKDF2, scrypt, Argon2)', 'Shown here: PBKDF2, 600,000 rounds'],
];

const INPUT_X = 28;
const SIZE = 10;
/** The width of one character of the monospaced font, in canvas units. */
const CHAR = SIZE * 0.6;
const NOTE_TOP = 136;
const NOTE_H = 54;

function Drawing({ step }: { step: number }) {
  // Key stretching takes the salt and the password as two inputs, so they are drawn apart; plain salting
  // hashes them as one string, so they are drawn as one string.
  const apart = step === 4;
  const notes = NOTES[step]!;
  return (
    <Canvas height={NOTE_TOP + NOTE_H + 8}>
      <Label x={INPUT_X} y={12} lines={['input']} size={SIZE} anchor="start" tone="muted" />
      <Label x={316} y={12} lines={[step >= 3 ? 'stored salt + hash' : 'stored hash']} size={SIZE} anchor="end" tone="muted" />
      {rows(step).map((row, i) => {
        const y = 24 + i * 34;
        const passwordX = INPUT_X + (row.salt.length + (apart ? 1 : 0)) * CHAR;
        return (
          <Layer key={i} state={row.state}>
            <Label x={4} y={y + 12} lines={[row.who]} size={SIZE} anchor="start" tone="muted" />
            <text data-input x={INPUT_X} y={y + 12} fontSize={SIZE} dominantBaseline="central" fill="var(--text)" className="font-mono">
              {/* The salt is marked three ways: colour, weight and underline, and it is labelled below. */}
              {row.salt && (
                <tspan data-salt fill="var(--accent)" fontWeight={700} textDecoration="underline">
                  {row.salt}
                </tspan>
              )}
              {row.salt && apart ? ' ' : ''}
              <tspan data-password>{row.password}</tspan>
            </text>
            {row.salt && (
              <>
                <Label x={INPUT_X} y={y + 25} lines={['salt']} size={SIZE} anchor="start" tone="accent" bold />
                <Label x={passwordX + 2} y={y + 25} lines={['password']} size={SIZE} anchor="start" tone="muted" />
              </>
            )}
            <Arrow from={[128, y + 12]} to={[140, y + 12]} />
            <Box x={140} y={y} w={60} h={24} lines={[step === 4 ? 'slow hash' : 'hash']} size={SIZE} bold={false} state={step === 4 ? 'on' : 'off'} />
            <Arrow from={[200, y + 12]} to={[212, y + 12]} />
            <text
              data-stored
              x={316}
              y={y + 12}
              textAnchor="end"
              fontSize={SIZE}
              fontWeight={step >= 1 && step <= 3 ? 600 : 400}
              dominantBaseline="central"
              fill="var(--text)"
              className="font-mono"
            >
              {row.stored}
            </text>
          </Layer>
        );
      })}

      <rect
        x={8}
        y={NOTE_TOP}
        width={304}
        height={NOTE_H}
        rx={6}
        fill="var(--bg)"
        stroke={step === 2 ? 'var(--accent)' : 'var(--muted)'}
        strokeWidth={step === 2 ? 2.5 : 1}
      />
      <Label x={160} y={NOTE_TOP + NOTE_H / 2 - ((notes.length - 1) * SIZE * 1.25) / 2} lines={notes} size={SIZE} />
    </Canvas>
  );
}

export function HashingSalting() {
  return <StepDiagram title="Hashing, salting and key stretching" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
