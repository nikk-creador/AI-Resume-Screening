import { useState } from 'react';
import { Alert, Button, Form, Input, Result, Spin, Typography } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { routes } from '../../../routes/paths';
import { setActiveCompanyId } from '../../../services/api/client';
import { acceptInvitation, loadInvitation } from '../../../services/organizationApi';
import { getErrorMessage } from '../../../services/screeningApi';
import type { AuthUser } from '../../../types/auth';

const { Paragraph, Text, Title } = Typography;

interface InvitationFormValues {
  full_name?: string;
  password?: string;
  confirm_password?: string;
}

export default function AcceptInvitationPage({ user }: { user: AuthUser | null }) {
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<InvitationFormValues>();
  const [errorMessage, setErrorMessage] = useState('');
  const [token] = useState(() => searchParams.get('token') ?? '');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invitationQuery = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => loadInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });
  const acceptMutation = useMutation({
    mutationFn: (values: InvitationFormValues) =>
      acceptInvitation(token, values.password, values.full_name?.trim()),
    onSuccess: ({ user }) => {
      const invitedCompanyId = invitationQuery.data?.company_id;
      if (!invitedCompanyId) return;
      setActiveCompanyId(invitedCompanyId);
      queryClient.setQueryData(['auth', 'current-user'], user);
      window.dispatchEvent(
        new CustomEvent('recruitai:active-company-change', { detail: invitedCompanyId }),
      );
      navigate(routes.screenings, { replace: true });
    },
    onError: (error) =>
      setErrorMessage(getErrorMessage(error, 'Could not accept this invitation.')),
  });

  if (!token) {
    return (
      <main className="auth-page">
        <Result
          status="error"
          title="Invitation link is missing"
          extra={<Link to={routes.signIn}>Go to sign in</Link>}
        />
      </main>
    );
  }
  if (invitationQuery.isPending) {
    return (
      <main className="auth-loading" aria-busy="true">
        <Spin size="large" />
      </main>
    );
  }
  if (invitationQuery.error || !invitationQuery.data) {
    return (
      <main className="auth-page">
        <Result
          status="error"
          title="Invitation is invalid or expired"
          subTitle={getErrorMessage(
            invitationQuery.error,
            'Ask the company administrator to send a new invitation.',
          )}
          extra={<Link to={routes.signIn}>Go to sign in</Link>}
        />
      </main>
    );
  }

  const invitation = invitationQuery.data;
  const signedInAsInvitee = user?.email.toLowerCase() === invitation.email.toLowerCase();
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="invitation-heading">
        <Text className="eyebrow">COMPANY INVITATION</Text>
        <Title id="invitation-heading" level={2}>
          Join {invitation.company_name}
        </Title>
        <Paragraph>
          You were invited to {invitation.company_name} in {invitation.organization_name} as{' '}
          {invitation.email}.
        </Paragraph>
        {signedInAsInvitee && (
          <Alert
            type="success"
            showIcon
            message="Signed in with the invited account"
            description="Accepting will add this company to your account without changing your current password."
            style={{ marginBottom: 16 }}
          />
        )}
        <Paragraph type="secondary">
          This invitation grants{' '}
          {[
            invitation.permissions.view && 'view',
            invitation.permissions.edit && 'edit and review',
            invitation.permissions.download && 'download',
          ]
            .filter(Boolean)
            .join(', ') || 'no screening'}{' '}
          access.
        </Paragraph>
        {errorMessage && (
          <Alert type="error" showIcon message={errorMessage} style={{ marginBottom: 16 }} />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            setErrorMessage('');
            acceptMutation.mutate(values);
          }}
        >
          {!signedInAsInvitee && (
            <>
              <Form.Item
                name="full_name"
                label="Full name"
                rules={[{ required: true, min: 2, max: 120 }]}
              >
                <Input autoComplete="name" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Set a password, or enter your existing account password"
                rules={[{ required: true, min: 12, max: 256 }]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm_password"
                label="Confirm password"
                dependencies={['password']}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value: string) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Passwords do not match.'));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          )}
          <Button type="primary" htmlType="submit" loading={acceptMutation.isPending} block>
            Accept invitation
          </Button>
        </Form>
      </section>
    </main>
  );
}
