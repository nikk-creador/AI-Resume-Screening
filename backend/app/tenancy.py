from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import (
    AuditLog,
    Company,
    CompanyMembership,
    Organization,
    OrganizationMembership,
    Screening,
    User,
)


def create_default_tenant(db: Session, user: User) -> Company:
    organization = Organization(
        id=str(uuid4()),
        name=f"{user.full_name}'s Organization"[:160],
    )
    company = Company(
        id=str(uuid4()),
        organization_id=organization.id,
        name=f"{user.full_name}'s Company"[:160],
    )
    db.add(organization)
    db.flush()
    db.add(company)
    db.flush()
    user.default_company_id = company.id
    db.add_all(
        [
            OrganizationMembership(
                id=str(uuid4()),
                organization_id=organization.id,
                user_id=user.id,
                role="admin",
                status="active",
            ),
            CompanyMembership(
                id=str(uuid4()),
                company_id=company.id,
                user_id=user.id,
                role="company_admin",
                status="active",
                can_view=True,
                can_edit=True,
                can_download=True,
                can_manage_members=True,
            ),
            AuditLog(
                id=str(uuid4()),
                organization_id=organization.id,
                company_id=company.id,
                actor_id=user.id,
                user_id=user.id,
                action="tenant.created",
                resource_type="company",
                resource_id=company.id,
            ),
        ]
    )
    db.flush()
    return company


def get_company_user(
    selected_company_header: str | None = Header(default=None, alias="X-Company-Id"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    selected_id = selected_company_header or user.default_company_id
    if not selected_id:
        raise HTTPException(status_code=403, detail="No active company membership is available.")

    membership = db.scalar(
        select(CompanyMembership)
        .join(Company, Company.id == CompanyMembership.company_id)
        .join(Organization, Organization.id == Company.organization_id)
        .where(
            CompanyMembership.user_id == user.id,
            CompanyMembership.company_id == selected_id,
            CompanyMembership.is_active.is_(True),
            Company.is_active.is_(True),
            Organization.is_active.is_(True),
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    user.active_company_id = membership.company_id
    user.company_membership = membership
    return user


def require_company_permission(user: User, permission: str) -> None:
    membership = getattr(user, "company_membership", None)
    if membership is None:
        return
    if not getattr(membership, permission, False):
        action = {
            "can_view": "view",
            "can_edit": "edit",
            "can_download": "download",
            "can_manage_members": "manage company members",
        }.get(permission, "perform this action")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You do not have permission to {action} this company's data.",
        )


def screening_company_scope(user: User):
    company_id = getattr(user, "active_company_id", None)
    if company_id:
        return Screening.company_id == company_id
    return Screening.owner_id == user.id


def resume_download_scope(user: User):
    require_company_permission(user, "can_download")
    return screening_company_scope(user)


def company_access_payload(
    membership: CompanyMembership,
    company: Company,
    organization: Organization,
    organization_role: str | None = None,
) -> dict:
    return {
        "id": company.id,
        "name": company.name,
        "organization_id": organization.id,
        "organization_name": organization.name,
        "organization_role": organization_role,
        "parent_company_id": company.parent_company_id,
        "role": membership.role,
        "permissions": {
            "view": membership.can_view,
            "edit": membership.can_edit,
            "download": membership.can_download,
            "manage_members": membership.can_manage_members,
        },
    }


def write_audit_log(
    db: Session,
    *,
    user: User,
    company: Company,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            id=str(uuid4()),
            organization_id=company.organization_id,
            company_id=company.id,
            actor_id=user.id,
            user_id=user.id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            created_at=datetime.now(timezone.utc),
        )
    )


def invitation_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=72)