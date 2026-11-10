import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'Client Hello (TLS 1.2)',
    description:
      'This diagram shows the handshake in the TLS 1.2 message order. The client opens with a Client Hello: the highest TLS version that it supports, the cipher suites that it supports, and a random value that is used later to make the keys.',
  },
  {
    title: 'Server Hello and cipher choice (TLS 1.2)',
    description:
      "The server answers with a Server Hello. It settles the TLS version, chooses one cipher suite from the client's list, and adds a random value of its own. In TLS 1.2 the cipher suite names four things: the key exchange method, how the server is authenticated, the symmetric cipher for the data, and the hash function.",
  },
  {
    title: 'Certificate (TLS 1.2)',
    description:
      "The server sends its certificate, together with the intermediate certificates of its chain. The client validates the chain up to a root that it trusts, and checks the dates and that the name matches the site. In TLS 1.2 the certificate travels in the clear. So far nothing proves that the sender holds the certificate's private key.",
  },
  {
    title: 'Key exchange (TLS 1.2)',
    description:
      "The server sends a one-time (ephemeral) Diffie-Hellman public value, signed with the private key of its certificate; the signature proves that the server holds that key. The client answers with a one-time value of its own. Each side combines its own private value with the other side's public value and reaches the same secret, which is never sent. Because the values are thrown away afterwards, a server key stolen later cannot unlock recorded sessions: this is forward secrecy. The older method, in which the client encrypted a secret with the server's RSA public key, has no forward secrecy; TLS 1.3 removed it in favor of ephemeral Diffie-Hellman.",
  },
  {
    title: 'Session keys, Finished (TLS 1.2)',
    description:
      'Both sides derive the same symmetric session keys from the shared secret and the two random values. Each then sends Change Cipher Spec, to say that it is switching to those keys, and a Finished message, which is encrypted and covers the whole handshake, so that a change made by an attacker in between is detected. A full TLS 1.2 handshake takes two round trips. TLS 1.3 sends the key share in the hello messages, before the certificate, and finishes in one round trip.',
  },
  {
    title: 'Encrypted data (TLS 1.2)',
    description:
      'The handshake is over. Application data, such as the HTTP request and the page, is encrypted with the session keys using a fast symmetric cipher such as AES-GCM, which also detects tampering. The asymmetric work was needed only to authenticate the server and to agree on the keys.',
  },
];

const CLIENT = 44;
const SERVER = 276;

type Message = { y: number; name: string; detail: string; flow: 'right' | 'left' | 'both'; encrypted: boolean };

// One per step, in the order they are sent in TLS 1.2.
const MESSAGES: Message[] = [
  { y: 64, name: 'Client Hello', detail: 'TLS version, cipher suites, random value', flow: 'right', encrypted: false },
  { y: 102, name: 'Server Hello', detail: 'chosen cipher suite, random value', flow: 'left', encrypted: false },
  { y: 140, name: 'Certificate', detail: 'in the clear in TLS 1.2', flow: 'left', encrypted: false },
  { y: 178, name: 'Key exchange', detail: 'one-time Diffie-Hellman values', flow: 'both', encrypted: false },
  { y: 216, name: 'Finished', detail: 'both sides switch to the session keys', flow: 'both', encrypted: true },
  { y: 254, name: 'Application data', detail: 'encrypted with the session keys', flow: 'both', encrypted: true },
];

function Drawing({ step }: { step: number }) {
  return (
    <Canvas height={290}>
      <Box x={8} y={8} w={72} h={26} lines={['Client']} size={10.5} />
      <Box x={240} y={8} w={72} h={26} lines={['Server']} size={10.5} />
      <Label x={160} y={21} lines={['TLS 1.2']} size={10} tone="muted" bold />
      <line x1={CLIENT} x2={CLIENT} y1={34} y2={266} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />
      <line x1={SERVER} x2={SERVER} y1={34} y2={266} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 3" />

      {MESSAGES.map((m, i) => {
        const state: Emphasis = i === step ? 'on' : i < step ? 'off' : 'hidden';
        return (
          <Layer key={m.name} state={state}>
            <Label x={160} y={m.y - 16} lines={[m.name]} size={10} bold />
            <Label x={160} y={m.y - 4} lines={[m.detail]} size={10} tone="muted" />
            <Arrow
              from={m.flow === 'left' ? [SERVER, m.y + 5] : [CLIENT, m.y + 5]}
              to={m.flow === 'left' ? [CLIENT, m.y + 5] : [SERVER, m.y + 5]}
              both={m.flow === 'both'}
              state={i === step ? 'on' : 'off'}
              dashed={!m.encrypted}
            />
          </Layer>
        );
      })}
      <Label x={160} y={279} lines={['Dashed line: in the clear. Solid line: encrypted.']} size={10} tone="muted" />
    </Canvas>
  );
}

export function TlsHandshake() {
  return <StepDiagram title="The TLS handshake (TLS 1.2 message order)" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
