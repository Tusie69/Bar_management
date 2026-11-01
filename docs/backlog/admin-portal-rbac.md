# Admin Portal RBAC backlog

Status: deferred by owner; not implemented. No admin RBAC migration is authorized by finalization.

The API currently has four roles (OWNER_ADMIN, RECEPTIONIST, CUSTOMER_CARE, CASHIER), 29 permissions and 59 grants after the phone revoke. Its migration runner reads `api/database/migrations`, identifies a migration by full filename and stores its SHA-256 in `schema_migrations(filename, checksum, applied_at)`. It does not read `db/migrations`.

`db/migrations/0004_admin_portal_rbac.sql` remains unchanged as a design artifact. It adds SUPER_ADMIN and ADMIN_VIEWER, `user.read` and `admin.access.change`, `role_portals`, `role_grant_rules`, seven portal mappings, seven grant rules and seven grants. It uses dbmate markers and has no executable down migration. The separate master `D:\GAM-APP\database\migrations\0001_initial_schema.sql` already incorporates those additions; applying this artifact after that master initial schema duplicates baseline objects.

Do not run that file as-is against the API lineage. API 0004 is reservation customer classification and API 0005 is the receptionist phone revoke; dbmate expects a different history shape, and copying another numeric 0004 into the API stream obscures ordering. The API runner provides neither a migration transaction nor an advisory lock, while this artifact mixes DDL and DML with implicit commits. A partial failure needs inspected recovery, not a blind rerun. Creating its mapping tables alone does not enforce portal or delegation rules: the API auth and canonical UI role mapping must support them explicitly.

## Proposed next work, after approval

1. Confirm the portal, role and delegation matrix with the PO, including tenant and venue boundaries and multi-role users. Choose the next unused filename after the current 0001-0005 lineage only after approval; 0005 is already used.
2. Write a reviewed additive migration against the actual API 0001-0005 lineage. Keep applied files and checksums unchanged, retain both owner phone-reveal permissions, and give neither new role phone reveal or venue configuration implicitly. Expected totals for the current proposal are six roles, 31 permissions and 66 grants.
3. Implement server-side portal eligibility and grant/lock/change checks, with explicit authorization for every mutation and audited actor/target/old/new roles. Apply changes to active sessions through the existing live permission resolution. Update API role responses and UI capabilities together; a portal mapping is not a substitute for endpoint permissions.
4. Test role combinations, cross-tenant/venue attempts, delegation escalation, last-owner protection, disabled users, CSRF, read-only admin writes, audit failure and next-request permission changes. New roles receive no automatic memberships or seed credentials.
5. Validate first on an approved isolated restore of API dev, including expected counts and unchanged business data. Review partial-application recovery and a forward compensation plan. Back up and approve each target independently before deployment.

## PO questions

- Does SUPER_ADMIN use ADMIN, a separate portal, or a cross-tenant control plane? Is it tenant-scoped?
- May SUPER_ADMIN lock owners or other super admins, and what protects the last usable owner/admin?
- May OWNER_ADMIN create another OWNER_ADMIN or ADMIN_VIEWER? May owners switch admin access levels, or only SUPER_ADMIN?
- May OWNER_ADMIN enter RECEPTION? How are multiple roles and conflicting portal rules combined?
- Does ADMIN_VIEWER see reports and masked customers only, and which account metadata may it read?
- What audit retention, approval, session revocation and account recovery rules apply to privileged changes?

Reference: [backend merge report](../integration/merge-be-report.md). No new migration, portal enforcement or role provisioning is included in this backlog entry.
