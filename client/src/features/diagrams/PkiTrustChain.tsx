import { Arrow, Box, Canvas, Label, Layer, type Emphasis } from './parts';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const STEPS: DiagramStep[] = [
  {
    title: 'A chain of trust',
    description:
      "A certificate ties a public key to a name, and is signed by a certificate authority (CA). The root CA is at the top; it is the root of trust. It signs the certificate of an intermediate CA, and the intermediate CA signs the certificate of a server, called the leaf or end-entity certificate. The root's private key is used rarely and the root is usually kept offline, so the intermediate does the daily work.",
  },
  {
    title: 'Certificate signing request (CSR)',
    description:
      'To get a certificate, the server owner first creates a key pair. The private key stays on the server. The public key and the name being requested go into a certificate signing request, which is sent to the CA. The request is signed with the new private key, which shows that the applicant holds it. The CA checks that the applicant really controls that name, and then issues a signed certificate. The CA never sees the private key.',
  },
  {
    title: 'Validation: walking the chain',
    description:
      "A browser that receives the server's certificate walks up the chain. It checks the server certificate's signature with the intermediate CA's public key, then the intermediate certificate's signature with the root CA's public key. The root must already be in the browser's trust store. The browser also checks the dates and that the name in the certificate matches the site.",
  },
  {
    title: 'Revocation: CRL',
    description:
      "A certificate can be revoked before it expires, for example when its private key is stolen. A certificate revocation list (CRL) is a signed list, published by the CA on a schedule, of the serial numbers of every certificate it has revoked. The browser downloads the list and looks for the certificate's serial number. Lists can be large, and are only as fresh as their last update.",
  },
  {
    title: 'Revocation: OCSP',
    description:
      "The Online Certificate Status Protocol (OCSP) asks about one certificate instead of downloading a list. The browser sends the serial number to the CA's OCSP responder and gets a signed answer in close to real time: good, revoked or unknown. With OCSP stapling, the web server fetches that answer itself and sends it along with its certificate.",
  },
  {
    title: 'Self-signed certificates',
    description:
      "A self-signed certificate is signed with its own private key, so no CA vouches for it. A root CA's certificate is itself self-signed; it is trusted only because it is preinstalled in the trust store. A self-signed certificate that is not in the trust store can still encrypt, but a browser cannot walk a chain from it to a root that it trusts, so it proves no identity and the browser shows a warning. Such certificates suit labs and internal devices, where the people who use them choose to trust them.",
  },
];

const CHAIN_X = 92;
const CHAIN_W = 136;
const ROWS = { root: 8, mid: 70, leaf: 132 } as const;
const BOX_H = 36;

function Drawing({ step }: { step: number }) {
  const at = (...steps: number[]): Emphasis => (steps.includes(step) ? 'on' : 'off');
  const only = (...steps: number[]): Emphasis => (steps.includes(step) ? 'on' : 'hidden');
  const walking = step === 2;
  return (
    <Canvas height={250}>
      <Box x={CHAIN_X} y={ROWS.root} w={CHAIN_W} h={BOX_H} lines={['Root CA', 'the root of trust']} state={at(0, 2, 5)} size={10} />
      <Box x={CHAIN_X} y={ROWS.mid} w={CHAIN_W} h={BOX_H} lines={['Intermediate CA']} state={at(0, 1, 2)} size={10.5} />
      <Box x={CHAIN_X} y={ROWS.leaf} w={CHAIN_W} h={BOX_H} lines={['Server certificate', '(leaf)']} state={at(0, 2, 3, 4)} size={10} />

      {/* Signing goes down the chain; validation goes back up it. */}
      {[ROWS.root, ROWS.mid].map((y) => (
        <g key={y}>
          <Arrow from={walking ? [160, y + 62] : [160, y + BOX_H]} to={walking ? [160, y + BOX_H] : [160, y + 62]} state={at(0, 2)} />
          <Label x={168} y={y + 49} lines={[walking ? 'check signature' : 'signs']} size={10} anchor="start" tone="muted" />
        </g>
      ))}

      {/* The request for a certificate */}
      <Box x={4} y={ROWS.leaf} w={74} h={BOX_H} lines={['CSR: public', 'key + name']} state={only(1)} size={10} />
      <Layer state={only(1)}>
        <path d={`M 41 ${ROWS.leaf} V ${ROWS.mid + BOX_H / 2}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <Arrow from={[41, ROWS.mid + BOX_H / 2]} to={[CHAIN_X, ROWS.mid + BOX_H / 2]} state="on" />
        <Label x={8} y={ROWS.leaf + BOX_H + 12} lines={['signed with the new', 'private key, which', 'stays on the server']} size={10} anchor="start" tone="muted" />
      </Layer>

      {/* The party that relies on the certificate */}
      <Box x={242} y={ROWS.leaf} w={74} h={BOX_H} lines={['Browser']} state={only(2, 3, 4)} size={10} />
      <Layer state={only(2, 3, 4)}>
        <Arrow from={[CHAIN_X + CHAIN_W, ROWS.leaf + BOX_H / 2]} to={[242, ROWS.leaf + BOX_H / 2]} state="on" />
      </Layer>
      <Layer state={only(2)}>
        <Label x={312} y={ROWS.leaf + BOX_H + 12} lines={['trust store', 'holds the root']} size={10} anchor="end" tone="muted" />
      </Layer>

      {/* Asking the CA whether the certificate was revoked */}
      <Box x={242} y={ROWS.mid} w={74} h={BOX_H} lines={step === 4 ? ['OCSP', 'responder'] : ['CRL']} state={only(3, 4)} size={10} />
      <Layer state={only(3, 4)}>
        <Arrow from={[279, ROWS.leaf]} to={[279, ROWS.mid + BOX_H]} state="on" both />
        <Label x={312} y={ROWS.leaf + BOX_H + 12} lines={step === 4 ? ['one certificate:', 'good or revoked?'] : ['whole list of', 'revoked serials']} size={10} anchor="end" tone="muted" />
        <Arrow from={[CHAIN_X + CHAIN_W, ROWS.mid + BOX_H / 2]} to={[242, ROWS.mid + BOX_H / 2]} state="off" />
      </Layer>

      {/* A certificate with no chain above it */}
      <Box x={76} y={206} w={168} h={BOX_H} lines={['Self-signed certificate', 'not in the trust store']} state={only(5)} size={10} dashed />
      <Layer state={only(5)}>
        <path d="M 244 216 H 260 V 232 H 250" fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        <polygon points="244,232 250,229 250,235" fill="var(--accent)" stroke="none" />
        <Label x={266} y={218} lines={['signs', 'itself']} size={10} anchor="start" tone="muted" />
        <Label x={CHAIN_X + CHAIN_W + 8} y={ROWS.root + BOX_H / 2 - 6} lines={['self-signed too:', 'trusted because', 'preinstalled']} size={10} anchor="start" tone="muted" />
      </Layer>
    </Canvas>
  );
}

export function PkiTrustChain() {
  return <StepDiagram title="PKI: the certificate trust chain" steps={STEPS} render={(step) => <Drawing step={step} />} />;
}
