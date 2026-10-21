import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../../services/api/queryKeys';
import {
  archiveCompany,
  createCompany,
  createOrganization,
  inviteCompanyMember,
  listCompanyAuditLog,
  listCompanyInvitations,
  listCompanyMembers,
  listOrganizationCompanies,
  getCompanyRetentionPolicy,
  resendCompanyInvitation,
  restoreCompany,
  revokeCompanyInvitation,
  revokeCompanyMember,
  updateCompanyMember,
  updateCompanyRetentionPolicy,
} from '../../../services/organizationApi';
import type {
  CompanyAccess,
  CompanyAuditEvent,
  CompanyInvitation,
  CompanyMember,
  CompanyPermissions,
  CompanyRetentionPolicy,
} from '../../../types/organization';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

function auditActionLabel(action: string) {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

interface OrganizationManagerProps {
  open: boolean;
  activeCompany: CompanyAccess;
  companies: CompanyAccess[];
  onClose: () => void;
  onCompanyCreated: (company: CompanyAccess) => void;
  onCompanyArchived: (companyId: string) => void;
  onCompanyRestored: () => Promise<void>;
}

export default function OrganizationManager({
  open,
  activeCompany,
  companies,
  onClose,
  onCompanyCreated,
  onCompanyArchived,
  onCompanyRestored,
}: OrganizationManagerProps) {
  const [inviteForm] = Form.useForm<CompanyPermissions & { email: string }>();
  const [companyForm] = Form.useForm<{ name: string; parent_company_id?: string }>();
  const [organizationForm] = Form.useForm<{ name: string; initial_company_name: string }>();
  const [retentionForm] =
    Form.useForm<
      Pick<
        CompanyRetentionPolicy,
        | 'enabled'
        | 'resume_after_days'
        | 'resume_action'
        | 'screening_after_days'
        | 'screening_action'
      >
    >();
  const [inviteLink, setInviteLink] = useState<{ companyId: string; url: string } | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManageMembers = activeCompany.permissions.manage_members;
  const membersQuery = useQuery({
    queryKey: queryKeys.organization.members(activeCompany.id),
    queryFn: () => listCompanyMembers(activeCompany.id),
    enabled: open && canManageMembers,
  });
  const invitationsQuery = useQuery({
    queryKey: queryKeys.organization.invitations(activeCompany.id),
    queryFn: () => listCompanyInvitations(activeCompany.id),
    enabled: open && canManageMembers,
  });
  const auditQuery = useQuery({
    queryKey: queryKeys.organization.auditLog(activeCompany.id),
    queryFn: () => listCompanyAuditLog(activeCompany.id),
    enabled: open && canManageMembers,
  });
  const retentionQuery = useQuery({
    queryKey: queryKeys.organization.retentionPolicy(activeCompany.id),
    queryFn: () => getCompanyRetentionPolicy(activeCompany.id),
    enabled: open && canManageMembers,
  });
  useEffect(() => {
    if (retentionQuery.data) {
      retentionForm.setFieldsValue({
        enabled: retentionQuery.data.enabled,
        resume_after_days: retentionQuery.data.resume_after_days,
        resume_action: retentionQuery.data.resume_action,
        screening_after_days: retentionQuery.data.screening_after_days,
        screening_action: retentionQuery.data.screening_action,
      });
    }
  }, [retentionForm, retentionQuery.data]);
  const organizationCompaniesQuery = useQuery({
    queryKey: queryKeys.organization.companies(activeCompany.organization_id),
    queryFn: () => listOrganizationCompanies(activeCompany.organization_id),
    enabled: open && activeCompany.organization_role === 'admin',
  });
  const orgCompanies = organizationCompaniesQuery.data
    ? organizationCompaniesQuery.data.filter((company) => company.is_active)
    : companies
        .filter((company) => company.organization_id === activeCompany.organization_id)
        .map((company) => ({ ...company, is_active: true }));
  const refreshAccess = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.organization.members(activeCompany.id),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.organization.invitations(activeCompany.id),
      }),
    ]);
  };
  const inviteMutation = useMutation({
    mutationFn: (values: CompanyPermissions & { email: string }) =>
      inviteCompanyMember(activeCompany.id, values.email, values),
    onSuccess: async (result) => {
      setInviteLink(
        result.action_url ? { companyId: activeCompany.id, url: result.action_url } : null,
      );
      inviteForm.resetFields();
      await refreshAccess();
      messageApi.success('Invitation sent. The recipient will set their own password.');
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not send invitation.')),
  });
  const companyMutation = useMutation({
    mutationFn: (values: { name: string; parent_company_id?: string }) =>
      createCompany(activeCompany.organization_id, values.name, values.parent_company_id || null),
    onSuccess: (result) => {
      onCompanyCreated({
        id: result.id,
        name: result.name,
        organization_id: result.organization_id,
        organization_name: activeCompany.organization_name,
        organization_role: activeCompany.organization_role,
        parent_company_id: result.parent_company_id,
        role: 'company_admin',
        permissions: { view: true, edit: true, download: true, manage_members: true },
      });
      companyForm.resetFields();
      messageApi.success('Subsidiary company created.');
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not create company.')),
  });
  const organizationMutation = useMutation({
    mutationFn: (values: { name: string; initial_company_name: string }) =>
      createOrganization(values.name, values.initial_company_name),
    onSuccess: (result) => {
      onCompanyCreated({
        id: result.company_id,
        name: result.company_name,
        organization_id: result.organization_id,
        organization_name: result.organization_name,
        organization_role: 'admin',
        parent_company_id: null,
        role: 'company_admin',
        permissions: { view: true, edit: true, download: true, manage_members: true },
      });
      organizationForm.resetFields();
      messageApi.success('Organization created.');
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not create organization.')),
  });
  const permissionMutation = useMutation({
    mutationFn: ({
      userId,
      permission,
      enabled,
    }: {
      userId: string;
      permission: keyof CompanyPermissions;
      enabled: boolean;
    }) => updateCompanyMember(activeCompany.id, userId, { [permission]: enabled }),
    onSuccess: refreshAccess,
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not update access.')),
  });
  const retentionMutation = useMutation({
    mutationFn: (values: Parameters<typeof updateCompanyRetentionPolicy>[1]) =>
      updateCompanyRetentionPolicy(activeCompany.id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.organization.retentionPolicy(activeCompany.id),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.organization.auditLog(activeCompany.id),
        }),
      ]);
      messageApi.success('Data retention policy saved.');
    },
    onError: (error) =>
      messageApi.error(getErrorMessage(error, 'Could not save the retention policy.')),
  });
  const revokeMemberMutation = useMutation({
    mutationFn: (userId: string) => revokeCompanyMember(activeCompany.id, userId),
    onSuccess: refreshAccess,
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not revoke member.')),
  });
  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => revokeCompanyInvitation(activeCompany.id, invitationId),
    onSuccess: refreshAccess,
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not revoke invitation.')),
  });
  const resendInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => resendCompanyInvitation(activeCompany.id, invitationId),
    onSuccess: async (result) => {
      setInviteLink(
        result.action_url ? { companyId: activeCompany.id, url: result.action_url } : null,
      );
      await refreshAccess();
      messageApi.success('Invitation resent with a new secure link.');
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not resend invitation.')),
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveCompany(activeCompany.id),
    onSuccess: () => {
      messageApi.success('Company archived. Its data is retained and access is disabled.');
      onCompanyArchived(activeCompany.id);
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not archive company.')),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreCompany,
    onSuccess: async () => {
      await onCompanyRestored();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organization.companies(activeCompany.organization_id),
      });
      messageApi.success('Company restored. Its data access remains membership-based.');
    },
    onError: (error) => messageApi.error(getErrorMessage(error, 'Could not restore company.')),
  });

  const columns: ColumnsType<CompanyMember> = [
    {
      title: 'Member',
      key: 'member',
      render: (_, member) => (
        <div>
          <Text strong>{member.full_name}</Text>
          <br />
          <Text type="secondary">{member.email}</Text>
        </div>
      ),
    },
    ...(
      [
        ['view', 'View'],
        ['edit', 'Edit'],
        ['download', 'Download'],
        ['manage_members', 'Members'],
      ] as const
    ).map(([permission, label]) => ({
      title: label,
      key: permission,
      align: 'center' as const,
      render: (_: unknown, member: CompanyMember) => (
        <Switch
          size="small"
          checked={member.permissions[permission]}
          disabled={
            !member.is_active ||
            permissionMutation.isPending ||
            (permission === 'view' &&
              (member.permissions.edit ||
                member.permissions.download ||
                member.permissions.manage_members))
          }
          aria-label={`${label} access for ${member.full_name}`}
          onChange={(enabled) =>
            permissionMutation.mutate({ userId: member.user_id, permission, enabled })
          }
        />
      ),
    })),
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, member) => (
        <Popconfirm
          title={`Remove ${member.full_name} from ${activeCompany.name}?`}
          okText="Remove"
          cancelText="Keep member"
          onConfirm={() => revokeMemberMutation.mutate(member.user_id)}
        >
          <Button type="link" danger disabled={!member.is_active || revokeMemberMutation.isPending}>
            Revoke
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Drawer
      title={`${activeCompany.organization_name} / ${activeCompany.name}`}
      open={open}
      onClose={() => {
        setInviteLink(null);
        onClose();
      }}
      width={720}
      destroyOnClose
    >
      {contextHolder}
      {!canManageMembers && (
        <Alert
          type="info"
          showIcon
          message="You have limited access to this company. A company administrator manages members and permissions."
        />
      )}
      {activeCompany.organization_role === 'admin' && (
        <>
          <Text strong>Create a subsidiary</Text>
          <Form
            form={companyForm}
            layout="inline"
            onFinish={(values) => companyMutation.mutate(values)}
            style={{ marginTop: 12 }}
          >
            <Form.Item name="name" rules={[{ required: true, min: 2, max: 160 }]}>
              <Input aria-label="Subsidiary company name" placeholder="Company name" />
            </Form.Item>
            <Form.Item name="parent_company_id">
              <Select
                allowClear
                placeholder="Parent company (optional)"
                aria-label="Parent company"
                style={{ width: 210 }}
                options={orgCompanies.map((company) => ({
                  label: company.name,
                  value: company.id,
                }))}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={companyMutation.isPending}>
                Create company
              </Button>
            </Form.Item>
          </Form>
          <Divider />
          <Text strong>Archived companies</Text>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            loading={organizationCompaniesQuery.isPending}
            dataSource={(organizationCompaniesQuery.data ?? []).filter(
              (company) => !company.is_active,
            )}
            style={{ marginTop: 12 }}
            columns={[
              { title: 'Company', dataIndex: 'name', key: 'name' },
              {
                title: '',
                key: 'restore',
                align: 'right',
                render: (_, company) => (
                  <Popconfirm
                    title={`Restore ${company.name}?`}
                    description="Only existing company members will regain access."
                    onConfirm={() => restoreMutation.mutate(company.id)}
                  >
                    <Button type="link" loading={restoreMutation.isPending}>
                      Restore
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
          <Divider />
          <Popconfirm
            title={`Archive ${activeCompany.name}?`}
            description="Members will lose access. Screening data will be retained."
            okText="Archive"
            cancelText="Keep company"
            onConfirm={() => archiveMutation.mutate()}
          >
            <Button danger loading={archiveMutation.isPending}>
              Archive company
            </Button>
          </Popconfirm>
          <Divider />
        </>
      )}
      <Text strong>Create an organization</Text>
      <Form
        form={organizationForm}
        layout="inline"
        onFinish={(values) => organizationMutation.mutate(values)}
        style={{ marginTop: 12 }}
      >
        <Form.Item name="name" rules={[{ required: true, min: 2, max: 160 }]}>
          <Input aria-label="Organization name" placeholder="Organization" />
        </Form.Item>
        <Form.Item name="initial_company_name" rules={[{ required: true, min: 2, max: 160 }]}>
          <Input aria-label="Initial company name" placeholder="First hiring company" />
        </Form.Item>
        <Form.Item>
          <Button htmlType="submit" loading={organizationMutation.isPending}>
            Create organization
          </Button>
        </Form.Item>
      </Form>
      {canManageMembers && (
        <>
          <Divider />
          <Text strong>Invite a member</Text>
          <Form
            form={inviteForm}
            layout="vertical"
            initialValues={{
              can_view: true,
              can_edit: false,
              can_download: false,
              can_manage_members: false,
            }}
            onFinish={(values) => inviteMutation.mutate(values)}
            style={{ marginTop: 12 }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="email"
                rules={[{ required: true, type: 'email' }]}
                style={{ flex: 1, marginBottom: 0 }}
              >
                <Input aria-label="Invite email" placeholder="name@company.com" />
              </Form.Item>
              <Button htmlType="submit" type="primary" loading={inviteMutation.isPending}>
                Send invite
              </Button>
            </Space.Compact>
            <Space wrap style={{ marginTop: 12 }}>
              <Form.Item name="can_view" valuePropName="checked" noStyle>
                <Checkbox>View screenings</Checkbox>
              </Form.Item>
              <Form.Item name="can_edit" valuePropName="checked" noStyle>
                <Checkbox>Edit and review</Checkbox>
              </Form.Item>
              <Form.Item name="can_download" valuePropName="checked" noStyle>
                <Checkbox>Download files</Checkbox>
              </Form.Item>
              <Form.Item name="can_manage_members" valuePropName="checked" noStyle>
                <Checkbox>Manage members</Checkbox>
              </Form.Item>
            </Space>
          </Form>
          {inviteLink?.companyId === activeCompany.id && (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message="Development invitation link"
              description={<a href={inviteLink.url}>{inviteLink.url}</a>}
            />
          )}
          <Divider />
          <Text strong>Members</Text>
          <Table
            rowKey="user_id"
            size="small"
            pagination={false}
            loading={membersQuery.isPending}
            dataSource={membersQuery.data ?? []}
            columns={columns}
            scroll={{ x: 620 }}
            style={{ marginTop: 12 }}
          />
          <Divider />
          <Text strong>Pending invitations</Text>
          <Table<CompanyInvitation>
            rowKey="id"
            size="small"
            pagination={false}
            loading={invitationsQuery.isPending}
            dataSource={invitationsQuery.data ?? []}
            style={{ marginTop: 12 }}
            columns={[
              { title: 'Email', dataIndex: 'email', key: 'email' },
              {
                title: 'Expires',
                dataIndex: 'expires_at',
                key: 'expires_at',
                render: (date: string) => new Date(date).toLocaleDateString(),
              },
              {
                title: '',
                key: 'actions',
                align: 'right',
                render: (_, invite) => (
                  <Space>
                    <Button
                      type="link"
                      loading={resendInvitationMutation.isPending}
                      onClick={() => resendInvitationMutation.mutate(invite.id)}
                    >
                      Resend
                    </Button>
                    <Popconfirm
                      title={`Revoke invitation for ${invite.email}?`}
                      onConfirm={() => revokeInvitationMutation.mutate(invite.id)}
                    >
                      <Button type="link" danger>
                        Revoke
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
          <Divider />
          <Text strong>Data retention</Text>
          <Text type="secondary">
            Rules use the resume upload date and screening creation date. Archive keeps records
            available for review; delete permanently removes their files and records.
          </Text>
          {retentionQuery.error && (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message={getErrorMessage(
                retentionQuery.error,
                'Could not load the retention policy.',
              )}
              action={<Button onClick={() => void retentionQuery.refetch()}>Retry</Button>}
            />
          )}
          <Form
            form={retentionForm}
            layout="vertical"
            initialValues={{
              enabled: false,
              resume_after_days: 365,
              resume_action: 'archive',
              screening_after_days: 730,
              screening_action: 'archive',
            }}
            onFinish={(values) => retentionMutation.mutate(values)}
            style={{ marginTop: 12 }}
          >
            <Form.Item name="enabled" valuePropName="checked">
              <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
            </Form.Item>
            <Space wrap align="start">
              <Form.Item
                label="Resumes older than (days)"
                name="resume_after_days"
                rules={[{ required: true, type: 'number', min: 1, max: 3650 }]}
              >
                <InputNumber min={1} max={3650} precision={0} />
              </Form.Item>
              <Form.Item label="Resume action" name="resume_action" rules={[{ required: true }]}>
                <Select
                  style={{ width: 150 }}
                  options={[
                    { label: 'Archive', value: 'archive' },
                    { label: 'Delete', value: 'delete' },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="Screenings older than (days)"
                name="screening_after_days"
                rules={[{ required: true, type: 'number', min: 1, max: 3650 }]}
              >
                <InputNumber min={1} max={3650} precision={0} />
              </Form.Item>
              <Form.Item
                label="Screening action"
                name="screening_action"
                rules={[{ required: true }]}
              >
                <Select
                  style={{ width: 150 }}
                  options={[
                    { label: 'Archive', value: 'archive' },
                    { label: 'Delete', value: 'delete' },
                  ]}
                />
              </Form.Item>
            </Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={retentionMutation.isPending}
              disabled={retentionQuery.isPending || Boolean(retentionQuery.error)}
            >
              Save retention policy
            </Button>
          </Form>
          <Divider />
          <Text strong>Recent audit history</Text>
          <Text type="secondary">
            Company actions, screening criteria changes, candidate reviews, and data deletions.
          </Text>
          <Table<CompanyAuditEvent>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5, size: 'small' }}
            loading={auditQuery.isPending}
            dataSource={auditQuery.data?.events ?? []}
            style={{ marginTop: 12 }}
            scroll={{ x: 820 }}
            columns={[
              {
                title: 'Activity',
                dataIndex: 'action',
                key: 'action',
                render: (action: string) => auditActionLabel(action),
              },
              {
                title: 'Who',
                dataIndex: 'actor_id',
                key: 'actor',
                render: (actorId: string | null) =>
                  actorId
                    ? (membersQuery.data?.find((member) => member.user_id === actorId)?.full_name ??
                      actorId.slice(0, 8))
                    : 'System',
              },
              {
                title: 'Details',
                dataIndex: 'details',
                key: 'details',
                render: (details: Record<string, unknown> | null) => {
                  const summary = details ? JSON.stringify(details) : '';
                  return summary ? <Text ellipsis={{ tooltip: summary }}>{summary}</Text> : '—';
                },
              },
              { title: 'Type', dataIndex: 'resource_type', key: 'resource_type' },
              {
                title: 'When',
                dataIndex: 'created_at',
                key: 'created_at',
                render: (date: string) => new Date(date).toLocaleString(),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
