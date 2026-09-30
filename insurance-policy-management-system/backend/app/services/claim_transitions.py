"""The claim workflow state machine: the single, central definition.

Reproduces `CLAIM_TRANSITIONS` in frontend/src/utils/claimWorkflow.js exactly
(snake_case statuses). Pure data, no imports beyond the enums, so the models
(for the history table's CHECK constraint), the services and the tests all
read the same table.

    draft ──submit──▶ submitted ──start_review──▶ under_review ──verify──▶ verified
      │                  │                                                    │
      └─cancel_draft─▶ cancelled ◀─withdraw─┘                               assess
                                                                              ▼
                     settled ◀──settle── approved ◀──approve── assessed ──reject──▶ rejected

`dedicated` transitions carry extra rules and can only be made through their
own action (filing, verification, assessment, decision, settlement).
"""

from dataclasses import dataclass

from app.models.enums import ClaimAction, ClaimStatus
from app.models.role import RoleName

S = ClaimStatus
A = ClaimAction
ADMIN, AGENT, HOLDER = RoleName.ADMINISTRATOR, RoleName.AGENT, RoleName.POLICYHOLDER


@dataclass(frozen=True)
class Transition:
    action: ClaimAction
    label: str
    roles: frozenset[RoleName]
    dedicated: str | None = None


CLAIM_TRANSITIONS: dict[ClaimStatus, dict[ClaimStatus, Transition]] = {
    S.DRAFT: {
        S.SUBMITTED: Transition(A.SUBMIT, "Claim submitted", frozenset({HOLDER, AGENT}), "filing"),
        S.CANCELLED: Transition(A.CANCEL_DRAFT, "Draft cancelled", frozenset({HOLDER, AGENT})),
    },
    S.SUBMITTED: {
        S.UNDER_REVIEW: Transition(A.START_REVIEW, "Review started", frozenset({ADMIN})),
        S.CANCELLED: Transition(A.WITHDRAW, "Claim withdrawn", frozenset({HOLDER, ADMIN})),
    },
    S.UNDER_REVIEW: {
        S.VERIFIED: Transition(A.VERIFY, "Claim verified", frozenset({ADMIN}), "verification"),
    },
    S.VERIFIED: {
        S.ASSESSED: Transition(A.ASSESS, "Claim assessed", frozenset({ADMIN}), "assessment"),
    },
    S.ASSESSED: {
        S.APPROVED: Transition(A.APPROVE, "Claim approved", frozenset({ADMIN}), "decision"),
        S.REJECTED: Transition(A.REJECT, "Claim rejected", frozenset({ADMIN}), "decision"),
    },
    S.APPROVED: {
        S.SETTLED: Transition(A.SETTLE, "Claim settled", frozenset({ADMIN}), "settlement"),
    },
    S.REJECTED: {},
    S.SETTLED: {},
    S.CANCELLED: {},
}

# (from, to, action) triples, e.g. for the claim_events CHECK constraint.
LEGAL_TRANSITIONS: tuple[tuple[ClaimStatus, ClaimStatus, ClaimAction], ...] = tuple(
    (source, target, rule.action)
    for source, targets in CLAIM_TRANSITIONS.items()
    for target, rule in targets.items()
)

# The main path a successful claim follows (the timeline's milestones).
HAPPY_PATH = (S.SUBMITTED, S.UNDER_REVIEW, S.VERIFIED, S.ASSESSED, S.APPROVED, S.SETTLED)

TERMINAL_STATUSES = frozenset(s for s, targets in CLAIM_TRANSITIONS.items() if not targets)
