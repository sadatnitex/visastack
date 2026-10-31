# How to start the Resource Lifecycle Programme

Two ways. The first is recommended: one coordinator session starts every lane for you.

## Option 1 (recommended): one coordinator session

Open a new Claude Code session on this repository and paste:

```
You are the coordinator of the VisaStack Resource Lifecycle Programme.

Authorisation (owner, for this programme only): I authorise you to start separate Claude Code
sessions, one per lane, exactly as listed in docs/roadmap/lifecycle/PROGRAMME.md section 4,
using the create_session tool. This replaces the "at most 2 helpers" and "one package per
session" limits for this programme only; every other rule in CLAUDE.md still applies to you and
to every lane. Each lane merges itself under the standing merge rule when its checks are green.
No production migration runs without my explicit word for that run.

Do this:
1. Read CLAUDE.md, then docs/roadmap/lifecycle/PROGRAMME.md and KICKOFF.md. Run the preflight:
   git fetch origin, main head, open pull requests, CI state of main. A red main is fixed first.
2. Check the next free migration number on fresh main and tell me if it is not 0112.
3. Wave 0: start four sessions with create_session, one per lane F, G1, G2, G3. For each, set
   outcome_branch to the branch named in its lane file, and use the lane prompt template in
   KICKOFF.md with <LANE> filled in. Do not write code yourself.
4. Do not poll. Arm one send_later check-in about 60 minutes ahead. At each check-in read each
   lane's session with get_session and its PR state, then report to me in plain words: lane,
   state, PR, blocked or not. Re-arm while any lane is open.
5. When lane F has merged to main, tell me the migration number so I can say "migrate <number>",
   then start wave 1: six sessions, lanes A1, A2, B, C, D, E, the same way.
6. When every wave 0 and wave 1 lane has merged, start lane Z.
7. If a lane writes a Blocked note, decide it only when the answer is already in PROGRAMME.md;
   otherwise bring it to me as one plain question.
8. Finish with Z's report and the list of my open gates (PROGRAMME section 10).
```

## Option 2: start each lane yourself

Open one new session per lane and paste the lane prompt below with `<LANE>` replaced. Start F, G1, G2 and G3 together. Start A1, A2, B, C, D and E together once F shows as merged. Start Z last.

## Lane prompt template

```
You are lane <LANE> of the VisaStack Resource Lifecycle Programme.

1. Read CLAUDE.md. Then read docs/SESSION-START.md sections 4 and 8 only. Then read
   docs/roadmap/lifecycle/PROGRAMME.md sections 2, 3, 5, 6 and 7, then your brief
   docs/roadmap/lifecycle/lanes/<LANE>.md. Nothing else unless your brief names it.
2. Push only to your session's designated branch. Edit only files matched by
   docs/roadmap/lifecycle/allowlists/<LANE>.txt, and before every commit run:
   node scripts/programme/check-allowed-paths.mjs docs/roadmap/lifecycle/allowlists/<LANE>.txt --no-emdash --exclude docs/design/harbor-v2
3. Use the frozen names of PROGRAMME section 3 exactly. Never add a migration unless you are
   lane F. Never run a production migration. Never edit another lane's files or the central
   status documents.
4. Confirm your approach in at most 3 bullets, then build. Write the "red first" tests before
   the fix and prove each new guard can fail.
5. Verify with one background run of scripts/agent/full-check.sh and read only its summary.
   Run the reviews your brief and PROGRAMME section 7 require and fix what they confirm.
6. Before merging, merge fresh origin/main into your branch, recheck, and wait for the three
   required checks on the exact head. Open a draft pull request with the template headings,
   then mark it ready and squash merge under the standing rule. Verify the deployment.
7. Fill in the Status section of your lane file in the same pull request. If you are blocked,
   write it under "Blocked" there, stop, and tell the owner in one plain sentence.
8. Report to the owner in plain words: what changed, what people will see, who notices,
   what is hidden until the migration, what is not verified.
```

## Order at a glance

```
Wave 0:  F ──────────┐   G1   G2   G3        (all four in parallel)
                     │
          owner: "migrate <number>" (any time after F merges; needed to go live, not to build)
                     │
Wave 1:  A1   A2   B   C   D   E              (all six in parallel, after F merged)
                     │
Wave 2:  Z                                     (after every lane merged)
```
