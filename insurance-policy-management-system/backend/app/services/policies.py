"""Issued policies: authorisation scope, listing, detail and issuance.

Authorisation is resolved here, never trusted from the client:

    user -> role -> business identity (agent / customer record) -> scope

* administrator: every policy
* agent:         policies where they are the servicing agent
* policyholder:  policies of the customer record linked to their login
* a login with no linked record sees nothing

A policy outside the caller's scope is reported as 404, exactly like a
policy that does not exist. Policy numbers are sequential and guessable, so
answering 403 would confirm which numbers exist to anyone who probes them.
"""

import logging
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import (
    Agent,
    Customer,
    NomineeRelationship,
    Policy,
    PolicyStatus,
    PremiumFrequency,
    ProductStatus,
    ProductType,
    RoleName,
    User,
)
from app.repositories import catalog as catalog_repo
from app.repositories import policies as policy_repo
from app.repositories.policies import PolicySort
from app.schemas.policies import (
    AddressOut,
    AgentOut,
    LifecycleEventOut,
    NomineeOut,
    PolicyholderOut,
    PolicyIssueRequest,
    PolicyListOut,
    PolicyOut,
    ProductRefOut,
)
from app.services.access import PolicyScope, resolve_scope  # noqa: F401 (re-exported)
from app.services.premiums import create_schedule
from app.services.pricing import instalment_premium, rate_annual_premium

logger = logging.getLogger(__name__)

MYSQL_DUPLICATE_ENTRY = 1062
DUPLICATE_PROPOSAL_KEY = "uq_policies_customer_id_product_id_start_date"


# Scope lives in app.services.access (shared with Module 2); re-exported here.


# --- responses --------------------------------------------------------------


def build_lifecycle(policy: Policy, today: date) -> list[LifecycleEventOut]:
    """Milestones from facts the database holds, not a fabricated history."""
    started = policy.issue_date is not None and policy.start_date <= today
    events = [
        LifecycleEventOut(
            stage="Policy issued",
            date=policy.issue_date,
            status="completed",
            note="Policy number generated and cover confirmed.",
        )
        if policy.issue_date
        else LifecycleEventOut(
            stage="Awaiting issuance",
            date=None,
            status="upcoming",
            note="Proposal recorded; the policy has not been issued yet.",
        ),
        LifecycleEventOut(
            stage="Cover starts",
            date=policy.start_date,
            status="completed" if started else "upcoming",
            note="Cover is in force from this date." if started else "Cover begins on this date.",
        ),
        LifecycleEventOut(
            stage="Cover ends",
            date=policy.end_date,
            status="completed" if policy.end_date < today else "upcoming",
            note="End of the policy term.",
        ),
    ]
    return events


def to_policy_out(policy: Policy, today: date | None = None) -> PolicyOut:
    customer, agent, product = policy.customer, policy.agent, policy.product
    frequency = PremiumFrequency(policy.premium_frequency)
    return PolicyOut(
        policy_number=policy.policy_number,
        status=PolicyStatus(policy.status),
        product=ProductRefOut(
            code=product.code, name=product.name, type=ProductType(product.product_type)
        ),
        policyholder=PolicyholderOut(
            customer_code=customer.customer_code,
            full_name=customer.full_name,
            date_of_birth=customer.date_of_birth,
            email=customer.email,
            phone=customer.phone,
            address=AddressOut(
                line1=customer.address_line1,
                line2=customer.address_line2,
                city=customer.city,
                state=customer.state,
                postal_code=customer.postal_code,
            ),
        ),
        nominee=NomineeOut(
            name=policy.nominee_name,
            relationship=NomineeRelationship(policy.nominee_relationship),
            date_of_birth=policy.nominee_date_of_birth,
        ),
        agent=AgentOut(
            agent_code=agent.agent_code,
            full_name=agent.full_name,
            branch=agent.branch,
            email=agent.email,
        )
        if agent
        else None,
        coverage_amount=policy.coverage_amount,
        annual_premium=policy.annual_premium,
        instalment_premium=instalment_premium(policy.annual_premium, frequency),
        premium_frequency=frequency,
        term_years=policy.term_years,
        issue_date=policy.issue_date,
        start_date=policy.start_date,
        end_date=policy.end_date,
        lifecycle=build_lifecycle(policy, today or date.today()),
    )


# --- queries ----------------------------------------------------------------


def list_policies(
    db: Session,
    user: User,
    *,
    search: str | None,
    status: PolicyStatus | None,
    product_code: str | None,
    agent_code: str | None,
    sort: PolicySort,
    limit: int,
    offset: int,
) -> PolicyListOut:
    if agent_code and user.role.name != RoleName.ADMINISTRATOR:
        raise ForbiddenError("Only administrators can filter policies by agent.")

    scope = resolve_scope(db, user)
    if scope.sees_nothing:
        return PolicyListOut(items=[], total=0, limit=limit, offset=offset)

    items, total = policy_repo.list_policies(
        db,
        agent_id=scope.agent.id if scope.agent else None,
        customer_id=scope.customer.id if scope.customer else None,
        search=search,
        status=status,
        product_code=product_code,
        agent_code=agent_code,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    today = date.today()
    return PolicyListOut(
        items=[to_policy_out(policy, today) for policy in items],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_policy(db: Session, user: User, policy_number: str) -> PolicyOut:
    policy = policy_repo.get_policy_by_number(db, policy_number)
    if policy is None or not resolve_scope(db, user).allows(policy):
        raise NotFoundError(f'No policy found for number "{policy_number}".')
    return to_policy_out(policy)


# --- issuance ---------------------------------------------------------------


def _age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def _field_error(field: str, message: str) -> dict[str, str]:
    return {"field": field, "message": message, "type": "business_rule"}


def _resolve_agent(db: Session, user: User, requested_code: str | None) -> Agent | None:
    if user.role.name == RoleName.AGENT:
        own = policy_repo.get_agent_by_user_id(db, user.id)
        if own is None:
            raise ForbiddenError("Your account is not linked to an agent record.")
        if requested_code and requested_code != own.agent_code:
            raise ForbiddenError("Agents can only issue policies as themselves.")
        return own

    if requested_code is None:
        return None
    agent = policy_repo.get_agent_by_code(db, requested_code)
    if agent is None:
        raise UnprocessableError(
            f"Agent {requested_code} was not found.",
            errors=[_field_error("body.agent_code", "Unknown agent code.")],
        )
    return agent


def _resolve_customer(db: Session, payload: PolicyIssueRequest) -> Customer:
    holder = payload.policyholder
    if holder.customer_code is None:
        customer = Customer(
            customer_code=policy_repo.next_customer_code(db),
            full_name=holder.full_name,
            date_of_birth=holder.date_of_birth,
            email=holder.email.lower(),
            phone=holder.phone,
            address_line1=holder.address_line1,
            address_line2=holder.address_line2,
            city=holder.city,
            state=holder.state,
            postal_code=holder.postal_code,
        )
        db.add(customer)
        return customer

    customer = policy_repo.get_customer_by_code(db, holder.customer_code)
    # Both cases give the same answer, so a customer code cannot be used to
    # discover someone's date of birth.
    if customer is None or customer.date_of_birth != holder.date_of_birth:
        raise UnprocessableError(
            f"Customer {holder.customer_code} was not found with this date of birth. "
            "Check the customer ID, or leave it blank to register a new customer.",
            errors=[
                _field_error("body.policyholder.customer_code", "No matching customer for this ID.")
            ],
        )
    return customer


def issue_policy(db: Session, user: User, payload: PolicyIssueRequest) -> PolicyOut:
    """Validate, rate, number and create a policy in ONE transaction.

    product -> business rules -> agent -> customer (existing or new)
    -> premium -> policy number -> insert policy + premium schedule -> COMMIT.
    Any failure rolls back everything, including a newly created customer,
    the schedule and its instalments, and the sequence counters.
    """
    if user.role.name not in (RoleName.AGENT, RoleName.ADMINISTRATOR):
        raise ForbiddenError("Only agents and administrators can issue policies.")

    today = date.today()
    try:
        product = catalog_repo.get_product_by_code(db, payload.product_code)
        if product is None:
            raise UnprocessableError(
                "Select a valid policy product before issuing.",
                errors=[_field_error("body.product_code", "Unknown product code.")],
            )
        if product.status != ProductStatus.ACTIVE:
            raise UnprocessableError(
                f"{product.name} is not available for issuance.",
                errors=[_field_error("body.product_code", "Product is inactive.")],
            )

        errors = []
        if not (
            product.min_coverage_amount <= payload.coverage_amount <= product.max_coverage_amount
        ):
            errors.append(
                _field_error(
                    "body.coverage_amount",
                    f"Must be between {product.min_coverage_amount:.0f} and "
                    f"{product.max_coverage_amount:.0f}.",
                )
            )
        if payload.term_years not in {o.term_years for o in product.term_options}:
            errors.append(_field_error("body.term_years", "Not offered for this product."))
        if payload.premium_frequency not in {f.frequency for f in product.premium_frequencies}:
            errors.append(_field_error("body.premium_frequency", "Not offered for this product."))
        age = _age_on(payload.policyholder.date_of_birth, today)
        if not product.min_entry_age <= age <= product.max_entry_age:
            errors.append(
                _field_error(
                    "body.policyholder.date_of_birth",
                    f"Age {age} is outside the entry age "
                    f"{product.min_entry_age}-{product.max_entry_age}.",
                )
            )
        if errors:
            raise UnprocessableError(
                "The policy details do not meet this product's rules.", errors=errors
            )

        agent = _resolve_agent(db, user, payload.agent_code)
        customer = _resolve_customer(db, payload)

        policy = Policy(
            policy_number=policy_repo.next_policy_number(db, today.year),
            product=product,
            customer=customer,
            agent=agent,
            issued_by_user_id=user.id,
            # Issuance through the workflow produces an in-force policy
            # immediately, as the frontend's issuance behaviour specifies.
            status=PolicyStatus.ACTIVE,
            coverage_amount=payload.coverage_amount,
            annual_premium=rate_annual_premium(product, payload.coverage_amount),
            premium_frequency=payload.premium_frequency,
            term_years=payload.term_years,
            issue_date=today,
            start_date=payload.start_date,
            nominee_name=payload.nominee.name,
            nominee_relationship=payload.nominee.relationship,
            nominee_date_of_birth=payload.nominee.date_of_birth,
        )
        db.add(policy)
        # Module 2 invariant: an issued policy never exists without its
        # premium schedule, so both are created in this same transaction.
        create_schedule(db, policy)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        orig = exc.orig
        if orig is not None and orig.args and orig.args[0] == MYSQL_DUPLICATE_ENTRY:
            if DUPLICATE_PROPOSAL_KEY in str(orig.args[-1]):
                raise ConflictError(
                    "This policyholder already has a policy for this product "
                    f"starting on {payload.start_date.isoformat()}."
                ) from None
            raise ConflictError(
                "The policy could not be issued: a record already exists."
            ) from None
        raise
    except Exception:
        db.rollback()
        raise

    db.refresh(policy)  # load the MySQL-generated end_date
    logger.info(
        "Policy issued",
        extra={
            "policy_number": policy.policy_number,
            "product": product.code,
            "issued_by_user_id": user.id,
            "agent_id": policy.agent_id,
        },
    )
    return to_policy_out(policy, today)
