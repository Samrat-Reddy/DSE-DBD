"""Authorisation scope shared by every policy-level domain (Modules 1 and 2).

    user -> role -> business identity (agent / customer record) -> scope

* administrator: every policy
* agent:         policies where they are the servicing agent
* policyholder:  policies of the customer record linked to their login
* a login with no linked record sees nothing

Anything outside the scope is reported as 404, exactly like something that
does not exist, so sequential identifiers cannot be probed.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import Agent, Customer, Policy, RoleName, User
from app.repositories import policies as policy_repo


@dataclass(frozen=True)
class PolicyScope:
    everything: bool = False
    agent: Agent | None = None
    customer: Customer | None = None

    def allows(self, policy: Policy) -> bool:
        if self.everything:
            return True
        if self.agent is not None:
            return policy.agent_id == self.agent.id
        if self.customer is not None:
            return policy.customer_id == self.customer.id
        return False

    @property
    def sees_nothing(self) -> bool:
        return not self.everything and self.agent is None and self.customer is None

    @property
    def agent_id(self) -> int | None:
        return self.agent.id if self.agent else None

    @property
    def customer_id(self) -> int | None:
        return self.customer.id if self.customer else None


def resolve_scope(db: Session, user: User) -> PolicyScope:
    role = user.role.name
    if role == RoleName.ADMINISTRATOR:
        return PolicyScope(everything=True)
    if role == RoleName.AGENT:
        return PolicyScope(agent=policy_repo.get_agent_by_user_id(db, user.id))
    if role == RoleName.POLICYHOLDER:
        return PolicyScope(customer=policy_repo.get_customer_by_user_id(db, user.id))
    return PolicyScope()
