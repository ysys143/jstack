# Secret shapes and the things that look like them

## Why shape, not entropy

Entropy alone reports every hash, every UUID, and every minified bundle. Each
family below is recognised by a **discriminator** — a structural feature that a
random-looking string of the same length does not have.

## Families

| Family | Discriminator | Note |
| --- | --- | --- |
| Provider-prefixed API key | A fixed vendor prefix followed by a fixed-length body | The prefix is the finding; length alone is not |
| Private key block | The PEM `BEGIN ... PRIVATE KEY` armour | The armour is unambiguous; report it without further scoring |
| Cloud access key pair | An id with a vendor prefix that appears near a longer secret half | The id alone is not the credential; the pair is |
| Bearer/session token | A three-part dot-separated structure whose first part base64-decodes to a JSON header | Decode the header — a real one names an algorithm |
| Connection string | A URI whose authority carries `user:password@` | The password is inside the URI; masking the host does not mask it |
| `.env` assignment | An assignment whose name ends in KEY, SECRET, TOKEN, PASSWORD, or CREDENTIAL | The name carries the signal; check the value is not a placeholder |

## False-positive families — do not report these

| Looks like | Why it is not a secret |
| --- | --- |
| A key in documentation with an obviously fake body | The vendor's own examples use reserved bodies; check the body against the vendor's example before reporting |
| A fixture with a fixed dummy value used across many tests | Its purpose is to be stable and public; rotating it breaks tests and protects nothing |
| The public half of a keypair | Publishing it is the point |
| A content hash, commit SHA, or UUID | High entropy, no issuer, nothing to authenticate against |
| A base64 blob that decodes to an image or an archive | Decode before scoring; the decode settles it |

## When the discriminator is ambiguous

Say which family you matched and what would settle it — usually "ask the issuer
whether this value authenticates". An unresolved candidate is reported as a
candidate, with its family named. It is never reported as a leak, and it is
never quietly dropped: silence reads as "checked and clean".

## Rotation is issuer-specific

There is no generic rotate command, and this skill does not invent one. Find the
issuer's own rotation path, use it, and confirm the old value now fails — the
confirmation is the evidence, not the rotation call returning success.
