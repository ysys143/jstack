# Attacker equals victim — the eight places that rebuttal is wrong

## Why this file cannot be separated from the self-rebuttal clause

The self-rebuttal clause says: if the only principal who can reach the defect
already owns everything the defect would reach, the finding is rebutted. The
attacker is the victim, and a person is allowed to hurt themselves.

That is correct most of the time. It is wrong in eight known places, and in
those places it is wrong in the same direction every time — **it deletes a true
finding and leaves no record that a finding was deleted**. A rebuttal that
silently removes real defects is worse than no rebuttal, because the count goes
down and the report reads as a cleaner codebase.

So the clause and this list ship together. **A review that applies the
self-rebuttal without this list in front of it is not running the rubric; it is
running half of it.** `rubric.md` states the same coupling from the other side.

## The standing hazard

The instruction "drop the security-specific checklist, stay domain-neutral"
reads as reasonable and, enforced to the letter, removes this file — every one
of the five inherited items is phrased in security vocabulary, so a
domain-neutral sweep classifies all five as the thing to cut. The reversal is
already reserved by the wording. That is why the list is written as a rubric
exception table rather than as a security checklist: the items are here because
they break a **judgement rule**, not because they are security topics.

## The list

Eight items. Five inherited from upstream security guidance, three from this
repository's own context. Each carries a **decider** — the single sentence that
decides whether the item applies to the finding in front of you. If the decider
does not fire, the self-rebuttal stands and the finding is dropped.

### E-1. SSRF — the request leaves the process

Source: upstream

The caller controls a URL; the process fetches it. The caller cannot reach the
internal network, but the process can, so "the attacker already has this" is
false — the attacker is borrowing an authority they do not hold. The victim is
whatever sits behind the boundary the process is on, and it never consented.

**Decider** — The exception applies when the principal constructing the request differs from the principal authorized to **send** it.

### E-2. LLM-agent capability gates

Source: upstream

An agent's tool permissions are a gate, and text the agent reads can move that
gate. The author of the text is not the holder of the permissions; the model in
between is a confused deputy with real credentials. Treating prompt-reachable
capability changes as self-inflicted assumes the reader and the runner are the
same principal, and in an agent they are structurally not.

**Decider** — The exception applies when input text can change **tool permissions or approval scope**.

### E-3. CWE-200 · CWE-359 · CWE-532 — exposure by record

Source: upstream

Exposure of sensitive information (CWE-200), of private personal information
(CWE-359), and insertion of sensitive information into a log file (CWE-532)
share one shape: the data belongs to a third party who is not in the room. The
person who triggers the disclosure owns the process, not the data. Logs are the
common case because they outlive the process, cross a retention boundary, and
are read by people with no relationship to the subject.

**Decider** — The exception applies when **the data subject is not the executing principal**.

### E-4. `.claude/settings` · `.vscode` — configuration that executes

Source: upstream

These files are read by tools that run commands. Writing one is not editing a
preference; it is scheduling execution on whichever machine opens the
repository next. The author and the executor are different people on different
machines, usually at different times, and the executor never reviewed the file.

**Decider** — The exception applies when **merely opening the file executes a command** and the person opening it is not its author.

### E-5. `/proc/<pid>` — the kernel's view of another process

Source: upstream

Reading another process's entry crosses a privilege boundary that the
filesystem makes look like an ordinary path. Same user is not same principal:
credentials, environment, and memory maps of a co-resident process belong to
that process, and the ambient authority of the account is not consent.

**Decider** — The exception applies when the operation reaches **another process's state**, even under the same account.

### E-6. Archive author is not the extractor

Source: local context

Path traversal on extraction — `Zip-slip` — is rebutted as self-inflicted
whenever the reviewer pictures one person zipping and unzipping their own file.
In this repository the picture is wrong in the direction that matters: an hwpx
is an archive, it arrives from a proposal author or a procuring agency, and the
extractor is us. The bytes were written by someone else and are unzipped with
our privileges into our tree.

This is the same class as E-4 and was absent from the inherited list, which is
why it has to be written down rather than inferred.

**Decider** — The exception applies when **the archive's author and extractor are different principals**.

### E-7. Skill and convention files are the agent instruction surface

Source: local context

`SKILL.md`, `references/*.md`, and the convention files are not documentation
that a human optionally reads. They are loaded into an agent's context and act
as instructions, which puts them in E-4's class: writing one changes what a
later run does, on someone else's task, with that run's tool permissions.

Without this item, every finding about skill or convention content is rebutted
as "the author is the runner", which is exactly false for a plugin that other
sessions load.

**Decider** — The exception applies when the document **directs execution in another session**.

### E-8. The disqualification axis

Source: local context

Character-count gates, NFC/NFD jamo separation, and template-shape violations
get rebutted as "the author is only hurting their own document". The victim is
not the author. The victim is the submission's standing at the procuring
agency's review, and the failure mode is **disqualification**, decided by
a third party, after the deadline, with no repair path.

The author cannot consent on behalf of an evaluation they do not run, so
"self-inflicted" does not classify the harm. Cost asymmetry is the point: the
defect is cheap to fix before submission and unfixable after.

**Decider** — The exception applies when the harm materializes as **disqualification during the procuring agency's review**.

## How this interacts with the report

- An exception that fires **restores** the finding; it does not raise its
  severity. Severity comes from the axis it was found on.
- Name the item (`E-6`) in the finding, so the reader can disagree with the
  exception rather than with the finding.
- When no item fires, say the self-rebuttal was applied and the finding was
  dropped. A dropped finding that leaves no line is the failure this file
  exists to prevent.
- The list is closed at eight. Adding a ninth is an edit to this file with a
  decider sentence, not a judgement call made during a review.

## Limits

- The decider sentences determine **applicability**, not truth. An exception that
  fires still needs the defect to be real.
- Five items are inherited and carry upstream's framing; the three local items
  were written here and have no upstream counterpart to check against.
- Nothing here says the self-rebuttal is a bad rule. It is a good rule with a
  known and enumerable set of places it inverts.
