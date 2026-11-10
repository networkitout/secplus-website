---
objective: "1.4"
title: "Cryptographic solutions: choosing the right tool"
minutes: 20
---

## Symmetric and asymmetric encryption

**Encryption** turns readable data (plaintext) into unreadable data (ciphertext) using an algorithm and a key. The algorithm is public; the protection comes from keeping the key secret.

Exam questions are about choosing the right tool for a goal: confidentiality (only the right people can read it), integrity (it has not been changed), authentication (it really came from who it claims) or non-repudiation (the sender cannot later deny sending it).

**Symmetric encryption** uses one shared key to encrypt and to decrypt. It is fast, so it does the heavy work: disks, databases, backups and network traffic. Its weakness is the key: both sides need the same secret, and you cannot simply send it across an untrusted network.

**Asymmetric encryption** uses a key pair: two keys that are mathematically linked. The **public key** can be given to anyone. The **private key** never leaves its owner. What one key of the pair does, only the other key can undo.

| Goal | Which keys are used |
| --- | --- |
| Confidentiality: send Marcus a secret | The sender encrypts with **Marcus's public key**. Marcus decrypts with **his private key**. |
| Digital signature: prove a message came from Priya | Priya signs with **her private key**. Anyone verifies with **her public key**. |

Asymmetric encryption is far slower, so it is not used for large amounts of data. Real systems are **hybrid**: they use asymmetric cryptography to set up a symmetric key, then use that key for the data.

**Key exchange** is how two parties end up with the same symmetric key over an untrusted network. There are two approaches:

- One side creates a random symmetric key and encrypts it with the other side's public key.
- Both sides use **Diffie-Hellman**. Each sends a public value, combines the value it receives with its own private value, and arrives at the same secret. The secret itself never crosses the network.

Diffie-Hellman only exchanges keys: it does not encrypt data, and on its own it does not prove who is at the other end.

:::diagram symmetric-vs-asymmetric

> **Exam tip:** For any key question, ask "whose key pair, and which half?" Confidentiality uses the recipient's pair: public to encrypt, private to decrypt. A signature uses the sender's pair: private to sign, public to verify.

:::check q-1.4-001

## Algorithms and key length

Know which family each common algorithm belongs to and which are retired; the mathematics is not needed.

| Family | Algorithm | What to know |
| --- | --- | --- |
| Symmetric | AES (Advanced Encryption Standard) | Block cipher with 128-, 192- or 256-bit keys. The current standard. |
| Symmetric | ChaCha20 | Stream cipher. A modern alternative to AES. |
| Symmetric | DES (Data Encryption Standard), 3DES (Triple DES), RC4 (Rivest Cipher 4) | Deprecated or insecure. Replace them. |
| Asymmetric | RSA (Rivest-Shamir-Adleman, its inventors) | Encryption and digital signatures. 2048-bit keys are the minimum in current practice. |
| Asymmetric | ECC (elliptic curve cryptography) | Much shorter keys than RSA for comparable strength. Includes ECDSA (Elliptic Curve Digital Signature Algorithm) for signatures and ECDH (Elliptic Curve Diffie-Hellman) for key exchange. |
| Asymmetric | Diffie-Hellman | Key exchange only, not encryption. |
| Hash | SHA-2 (Secure Hash Algorithm 2, which includes SHA-256), SHA-3 | Current choices. |
| Hash | MD5 (Message Digest 5), SHA-1 | Broken for collision resistance: attackers can produce two inputs with the same hash. Do not use them for signatures or certificates. |

A **block cipher** encrypts data in fixed-size blocks. A **stream cipher** encrypts it one bit or byte at a time. Hash functions are not encryption at all; a later section covers them.

**Key length** is the number of bits in a key. Within one algorithm, a longer key means more possible keys and more work for an attacker, but also more processing. AES-256 is stronger than AES-128. RSA-4096 is stronger than RSA-2048, and noticeably slower.

Key lengths can only be compared **within the same algorithm**. RSA and Diffie-Hellman are attacked with mathematics rather than by trying every key, so they need much longer keys than a symmetric cipher for the same strength. ECC needs far shorter keys than RSA: a 256-bit ECC key is roughly comparable to a 3072-bit RSA key.

> **Common trap:** "The bigger number wins" is wrong across different algorithms, even two from the same family. A 2048-bit RSA key is not stronger than a 256-bit AES key, and a 256-bit ECC key is not weaker than a 2048-bit RSA key.

:::check q-1.4-003

## Encryption levels

Stored data (data at rest) can be encrypted at different levels. The level decides what is protected, and against whom.

| Level | What is encrypted | What it is good for | Its limit |
| --- | --- | --- | --- |
| **Full-disk** | The whole drive, including the operating system and temporary files | A lost or stolen device that is powered off | Nothing is protected from a user or program on the running, unlocked system |
| **Partition** | One partition (section) of a drive; other partitions are left unencrypted | Protecting a data partition without encrypting the rest | Anything outside that partition is readable |
| **Volume** | One logical drive, which may be a single partition, span several disks, or be a container file that is mounted as a drive | An encrypted drive that can be mounted only when needed | Once mounted, its contents are available to the system |
| **File** | Individual files or folders, often with a key tied to one user account | Keeping a file from other users of the same computer | Only the chosen files are covered |
| **Database** | The database's data files, logs and backups. Transparent data encryption (TDE) does this without changes to applications | Stolen database files, disks or backups | Anyone who can query the running database sees plaintext |
| **Record** | Individual records (rows), or sensitive fields within them, each encrypted with a key the application controls | Hiding chosen data even from database administrators | More key management and slower queries |

A switched-off laptop with full-disk encryption left in a taxi is a lost asset, not a data breach. The same laptop is not protected against malware that runs while its user is logged in, because the operating system decrypts data for every running process.

The levels are layers, not rivals. A hospital might use full-disk encryption on a database server, TDE for the patient database, and record-level encryption for the fields that hold national ID numbers.

All of these protect stored data. Data moving across a network needs transport encryption, covered in a later section.

> **Exam tip:** Match the level to the threat. Stolen, powered-off device: full-disk. Other users of the same computer: file. Stolen database backups: database. Data that even an administrator must not read: record.

:::check q-1.4-006

## Hashing, salting and key stretching

A **hash function** turns any input into a short, fixed-length value called a hash or digest. **Hashing** has three properties to remember:

- It is one-way. You cannot work back from the hash to the input, and there is no key.
- The same input always gives the same hash.
- Any change to the input, however small, gives a completely different hash.

That makes hashing the tool for **integrity**. Download a firmware image, hash it, and compare the result with the hash the vendor published. If they match, the file is unchanged. Hashing gives no confidentiality: there is nothing to decrypt.

Two different inputs with the same hash are a **collision**. MD5 and SHA-1 are broken because attackers can create collisions on purpose.

Systems store a hash of each password instead of the password itself. Plain hashing has two weaknesses: two users with the same password have the same hash, and an attacker can look up each stolen hash in a **rainbow table**, a precomputed table of hashes for millions of likely passwords.

**Salting** fixes both. A salt is a unique random value that is added to each password before hashing. It is stored next to the hash and is not secret. Identical passwords now produce different hashes, and a precomputed table is useless because it was not built with those salts.

**Key stretching** makes every guess slow. The password is run through a function that is deliberately expensive, for example thousands of rounds of hashing. A login still takes a fraction of a second, but an attacker who needs billions of guesses is slowed enormously. The key-stretching functions to know are bcrypt, PBKDF2 (Password-Based Key Derivation Function 2), scrypt and Argon2.

:::diagram hashing-salting

One more relative: an **HMAC** (hash-based message authentication code) is a hash calculated with a shared secret key. A plain hash proves nothing if an attacker can change the message and then recompute the hash. An HMAC can only be produced by someone who holds the key, so it gives integrity and authenticity.

:::check q-1.4-010

## Digital signatures and blockchain

A **digital signature** combines hashing with asymmetric keys:

1. The sender hashes the message.
2. The sender signs the hash with the sender's own **private key**. The result is the signature, which is sent with the message.
3. The recipient hashes the message they received, then uses the sender's **public key** to check the signature against that hash.

If the check passes, the message has not changed (integrity), it came from the holder of that private key (authentication), and the sender cannot credibly deny it (non-repudiation). Signed software updates, signed email and certificates all rely on this.

> **Common trap:** A digital signature does not provide confidentiality. The message travels in readable form. To get both, the sender signs with their own private key and also encrypts with the recipient's public key.

| Technique | Key | Provides |
| --- | --- | --- |
| Hash | None | Integrity |
| HMAC | A shared secret key | Integrity and authenticity, but not non-repudiation, because both parties hold the key |
| Digital signature | The sender's private key | Integrity, authentication and non-repudiation |

A **blockchain** applies the same ideas to record keeping. It is a distributed, append-only ledger: a record of transactions copied across many participants, where entries are added and never edited. Transactions are grouped into blocks, and each block contains the hash of the previous block. Change an old block and its hash changes, which breaks the link to every later block, so tampering is evident to everyone holding a copy.

An **open public ledger** is a ledger that anyone can read and verify, not only its members. Public blockchains, such as those behind cryptocurrencies, are the usual example. An open public ledger provides transparency and integrity, not confidentiality, so it is no place for secrets.

:::check q-1.4-015

## Obfuscation: steganography, tokenization and data masking

**Obfuscation** means making data hard to find or hard to understand.

**Steganography** hides the existence of data inside another file, such as an image, an audio clip or a video. For example, a message can be stored in tiny changes to pixel colors that the eye cannot see. Attackers use it to smuggle data out of a network. It is not encryption: anyone who knows where to look can extract the data.

**Tokenization** replaces a sensitive value with a random stand-in called a token. The real value is kept in a separate, heavily protected token vault, which holds the mapping between tokens and real values. A token has no mathematical relationship to the original, so there is no key that can reverse it. Stores use tokens so that their own systems never hold card numbers.

**Data masking** hides part or all of a value from the person viewing it. A receipt that shows a card number as asterisks followed by the last four digits is masked. Masked copies of real data are also used for testing.

These techniques, encryption and hashing are easy to confuse. The difference is in how, and whether, the original can be recovered.

| Technique | What it does | Can the original be recovered? |
| --- | --- | --- |
| Encryption | Scrambles data with a key | Yes, by anyone with the key |
| Hashing | Produces a one-way, fixed-length digest | No |
| Tokenization | Swaps the value for a random token | Only by asking the vault; never by calculation |
| Data masking | Hides characters of the value | Not from the masked value |
| Steganography | Hides data inside another file | Yes, by anyone who knows it is there |

:::check q-1.4-020

## Certificates and public key infrastructure

How do you know that a public key really belongs to your bank? A **certificate** binds a public key to an identity, such as a hostname, and is digitally signed by a **certificate authority (CA)** that has checked the identity. **Public key infrastructure (PKI)** is the system of CAs, certificates, keys and processes used to issue, use and revoke certificates.

CAs form a chain. At the top is the root CA, whose certificate is preinstalled in the trust store (the list of root certificates a device trusts) of operating systems and browsers. It is the **root of trust**: the starting point that is trusted without further proof, and the reason everything beneath it is trusted. The root signs intermediate CAs, and the intermediates issue the certificates that servers use. This design lets the root's private key stay offline, and a compromised intermediate can be revoked without replacing the root on every device. A client validates a certificate by walking the chain upward, checking each signature until it reaches a root it trusts.

:::diagram pki-trust-chain

A **third-party** certificate is issued by a public CA that browsers already trust. Use one for anything the public will reach.

A **self-signed** certificate is signed with its own private key, so no CA vouches for it. A root CA's certificate is self-signed too; it is trusted only because it is preinstalled in the trust store. A self-signed certificate that is not in the trust store can still encrypt, but it proves no identity, and browsers warn about it. Such certificates suit labs and internal devices.

An organization can also run its own internal CA, whose certificates are trusted only by devices that have its root certificate installed, such as company-managed computers.

Getting a certificate starts with **certificate signing request (CSR) generation**:

1. Generate a key pair on the server.
2. Create a CSR. It contains the public key and identifying details such as the hostname, and it is signed with the applicant's private key.
3. Submit the CSR to the CA.
4. The CA validates the requester, for example by checking control of the domain.
5. The CA issues the signed certificate.
6. Install the certificate on the server.

The private key never leaves the applicant. The CA never sees it.

A **wildcard** certificate covers every hostname one level below a domain. A certificate for `*.example.com` covers `www.example.com` and `mail.example.com`. It does not cover `a.b.example.com`, which is two levels down. Nor does it cover the bare `example.com`, unless that name is also listed.

A certificate may have to be revoked before it expires, for instance when its private key is stolen. Clients learn about revocation in two ways.

| | Certificate revocation list (CRL) | Online Certificate Status Protocol (OCSP) |
| --- | --- | --- |
| What it is | A signed list of the serial numbers of revoked certificates | A query about the status of one certificate |
| How current | As current as the CA's last scheduled publication | Close to real time |
| What the client gets | The whole list | Good, revoked or unknown |

With OCSP stapling, the web server fetches a signed, time-stamped OCSP response for its own certificate from the CA and presents it during the TLS handshake (see the next section), which saves the client a separate query.

:::check q-1.4-023

## Transport encryption and the TLS handshake

**Transport encryption**, also called communication encryption, protects data while it moves across a network (data in transit). Transport Layer Security (TLS) protects web traffic as HTTPS, as well as email and many other protocols. Virtual private network (VPN) tunnels and Secure Shell (SSH) sessions are other examples. Transport encryption stops eavesdropping and tampering on the path, but does nothing for data once it has arrived and been stored.

A TLS connection begins with a handshake that sets up the keys. In TLS 1.2 it runs like this:

1. **Hello.** The client offers its TLS version and cipher suites (sets of algorithms). The server chooses from what was offered.
2. **Certificate.** The server sends its certificate. The client validates it against a trusted root.
3. **Key exchange.** The two sides agree on a secret, usually with a form of Diffie-Hellman. The server signs its part with the private key that matches its certificate, which proves it is the certificate's real owner.
4. **Session keys.** Both sides derive the same symmetric session keys from that secret.
5. **Encrypted data.** Everything after that is encrypted with the session keys, using a symmetric cipher such as AES or ChaCha20.

:::diagram tls-handshake

This is the hybrid model: asymmetric cryptography authenticates the server and agrees on the keys, and symmetric session keys encrypt the data.

The versions differ:

- TLS 1.2 also allows an older RSA key exchange, in which the client encrypts a secret with the server's public key.
- TLS 1.3 removed that option. Its key exchange uses Diffie-Hellman with fresh, temporary (ephemeral) keys for each session, so a server key stolen later cannot decrypt recorded sessions. This is perfect forward secrecy (PFS), also called forward secrecy. TLS 1.3 also sends the key exchange values inside the hello messages, which saves a round trip, and it dropped weak ciphers such as RC4 and 3DES.
- SSL (Secure Sockets Layer, the predecessor of TLS), TLS 1.0 and TLS 1.1 are deprecated and should be disabled.

:::check q-1.4-030

## Protecting the keys: tools and key escrow

Every technique above fails if keys are stolen or lost. Four tools protect them.

| Tool | What it is | Typical use |
| --- | --- | --- |
| **Trusted Platform Module (TPM)** | A chip on the motherboard, bound to that one device | Storing the device's disk encryption key. It also supports measured boot: it records hashes of the startup components, so the key can be withheld if the startup has been tampered with |
| **Hardware security module (HSM)** | A dedicated, tamper-resistant device or cloud service, often reached over the network, that generates, stores and uses keys, which never leave it | A CA's signing keys, payment processing, and other high-volume work shared by many servers |
| **Key management system** | A central service that manages keys through their lifecycle: creation, rotation and revocation | Keeping track of many keys across many applications, with access rules and logging |
| **Secure enclave** | An isolated, protected processing area inside a processor or device, separate from the main operating system | Handling fingerprint data and keys on a phone, which stay protected even if the operating system is compromised |

The pair most often confused: a TPM protects one computer's keys, while an HSM is separate hardware that protects keys for many systems.

**Key escrow** deals with the opposite risk: losing a key. A trusted third party holds a copy of the keys so that encrypted data can be recovered if a key is lost or its owner leaves the organization. The escrow is one more place where keys exist, so access to it must be tightly controlled.

> **Exam tip:** One device's keys: TPM. Keys for many systems, in tamper-resistant hardware: HSM. Central management of the key lifecycle: key management system. An isolated area inside a processor: secure enclave. Recovering data after a key is lost: key escrow.

:::check q-1.4-034
