import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { GoogleLogin } from '@react-oauth/google';

import { routes } from '../../../routes/paths';
import type { AuthActionResponse } from '../../../services/authApi';

const { Paragraph, Text, Title } = Typography;
const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'demo@recruitai.local';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || 'RecruitAI-Demo-2026!';

interface SignInProps {
  mode: AuthMode;
  error?: string;
  loading: boolean;
  onClearError: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  onGoogleSignIn: (credential: string) => Promise<void>;
  onRegister: (fullName: string, email: string, password: string) => Promise<AuthActionResponse>;
  onVerifyEmail: (token: string) => Promise<AuthActionResponse>;
  onRequestPasswordReset: (email: string) => Promise<AuthActionResponse>;
  onResetPassword: (token: string, password: string) => Promise<AuthActionResponse>;
}

export type AuthMode = 'signin' | 'register' | 'forgot' | 'verify' | 'reset';

interface SignInFormValues {
  email: string;
  password: string;
}

interface EmailFormValues {
  email: string;
}

interface RegistrationFormValues extends EmailFormValues {
  fullName: string;
  password: string;
  confirmPassword: string;
}

interface ResetFormValues {
  password: string;
  confirmPassword: string;
}

export default function SignIn({
  mode,
  error,
  loading,
  onClearError,
  onSubmit,
  onGoogleSignIn,
  onRegister,
  onVerifyEmail,
  onRequestPasswordReset,
  onResetPassword,
}: SignInProps) {
  const [form] = Form.useForm<SignInFormValues>();
  const [searchParams] = useSearchParams();
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const visibleError = submitError || error;
  const token = searchParams.get('token') ?? '';
  const busy = loading || submitting;

  useEffect(() => {
    const container = googleButtonRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setGoogleButtonWidth(Math.min(400, Math.max(200, Math.floor(entry.contentRect.width))));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleSubmit = async (values: SignInFormValues) => {
    setSubmitError('');
    onClearError();
    try {
      await onSubmit(values.email.trim().toLowerCase(), values.password);
    } catch (submitError: unknown) {
      setSubmitError(
        submitError instanceof Error ? submitError.message : 'Could not sign in. Try again.',
      );
    }
  };

  const fillDemoAccount = () => {
    form.setFieldsValue({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    setSubmitError('');
    onClearError();
  };

  const clearSignInError = () => {
    setSubmitError('');
    setSuccessMessage('');
    setActionUrl('');
    onClearError();
  };

  const runAction = async (action: () => Promise<AuthActionResponse>) => {
    clearSignInError();
    setSubmitting(true);
    try {
      const result = await action();
      setSuccessMessage(result.message);
      setActionUrl(result.action_url ?? '');
    } catch (actionError: unknown) {
      setSubmitError(
        actionError instanceof Error ? actionError.message : 'The request could not be completed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = (values: RegistrationFormValues) =>
    runAction(() =>
      onRegister(values.fullName.trim(), values.email.trim().toLowerCase(), values.password),
    );

  const handleEmailRequest = (values: EmailFormValues) => {
    const email = values.email.trim().toLowerCase();
    return runAction(() => onRequestPasswordReset(email));
  };

  const handleVerifyEmail = () =>
    runAction(() => {
      if (!token) throw new Error('This verification link is missing or invalid.');
      return onVerifyEmail(token);
    });

  const handleResetPassword = (values: ResetFormValues) =>
    runAction(() => {
      if (!token) throw new Error('This password reset link is missing or invalid.');
      return onResetPassword(token, values.password);
    });

  const handleGoogleSuccess = async (credential?: string) => {
    if (!credential) {
      setSubmitError('Google did not return a sign-in credential. Try again.');
      return;
    }
    setSubmitError('');
    onClearError();
    try {
      await onGoogleSignIn(credential);
    } catch (signInError: unknown) {
      setSubmitError(
        signInError instanceof Error
          ? signInError.message
          : 'Could not sign in with Google. Try again.',
      );
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-showcase" aria-labelledby="showcase-heading">
          <a className="brand auth-brand" href="#main" aria-label="RecruitAI home">
            <span className="brand-mark">R</span>
            <span>
              Recruit<span className="brand-accent">AI</span>
            </span>
          </a>
          <div className="auth-showcase-copy">
            <Text className="auth-kicker">
              <TeamOutlined /> THE RECRUITING WORKSPACE
            </Text>
            <Title id="showcase-heading" level={1}>
              Great teams start with <span>better hiring.</span>
            </Title>
            <Paragraph>
              Bring resumes and role requirements together, so every candidate gets a thoughtful
              review.
            </Paragraph>
          </div>
          <div className="auth-visual" aria-hidden="true">
            <div className="auth-visual-orbit auth-visual-orbit-one" />
            <div className="auth-visual-orbit auth-visual-orbit-two" />
            <div className="auth-visual-header">
              <span className="auth-visual-live">
                <span /> YOUR HIRING DESK
              </span>
              <SafetyCertificateOutlined />
            </div>
            <div className="auth-candidate-card auth-candidate-main">
              <div className="auth-candidate-topline">
                <span className="auth-candidate-avatar">JM</span>
                <span className="auth-candidate-status">
                  <CheckCircleFilled /> READY TO REVIEW
                </span>
              </div>
              <Text strong>Jordan Miller</Text>
              <Text className="auth-candidate-role">Product designer · 4 years experience</Text>
              <div className="auth-candidate-tags">
                <span>Product design</span>
                <span>Research</span>
                <span>Figma</span>
              </div>
            </div>
            <div className="auth-candidate-card auth-candidate-float">
              <span className="auth-float-icon">
                <TeamOutlined />
              </span>
              <span>
                <Text strong>Role match</Text>
                <Text>Senior product designer</Text>
              </span>
              <span className="auth-float-count">08</span>
            </div>
            <div className="auth-visual-caption">
              <span>RESUME</span>
              <i />
              <span>ROLE</span>
              <i />
              <span>HUMAN REVIEW</span>
            </div>
          </div>
          <Text className="auth-showcase-footer">AI-assisted review. Human-led decisions.</Text>
        </section>

        <section className="auth-card-wrap" aria-labelledby="signin-heading">
          <Card className="auth-card" bordered={false}>
            <div className="auth-card-heading">
              <span className="auth-card-icon">
                <LockOutlined />
              </span>
              <Text className="eyebrow">RECRUITAI ACCOUNT</Text>
            </div>
            <Title id="signin-heading" level={2}>
              {mode === 'signin' && 'Welcome back'}
              {mode === 'register' && 'Create your account'}
              {mode === 'forgot' && 'Reset your password'}
              {mode === 'verify' && 'Confirm your email'}
              {mode === 'reset' && 'Choose a new password'}
            </Title>
            <Paragraph className="auth-description">
              {mode === 'signin' && 'Sign in to continue to your hiring workspace.'}
              {mode === 'register' &&
                'Set up your RecruitAI account to start reviewing candidates.'}
              {mode === 'forgot' && 'Enter your work email and we will send a reset link.'}
              {mode === 'verify' && 'Verify your email address to activate password sign-in.'}
              {mode === 'reset' && 'Choose a new password for your RecruitAI account.'}
            </Paragraph>
            {successMessage && (
              <Alert
                className="auth-success"
                type="success"
                showIcon
                title={successMessage}
                description={
                  actionUrl ? <a href={actionUrl}>Open your secure action link</a> : undefined
                }
              />
            )}
            {visibleError && (
              <Alert
                className="auth-error"
                type="error"
                showIcon
                role="alert"
                title={visibleError}
                closable
                onClose={clearSignInError}
              />
            )}
            {mode === 'signin' && (
              <Form
                form={form}
                layout="vertical"
                requiredMark={false}
                scrollToFirstError
                onFinish={handleSubmit}
                onValuesChange={clearSignInError}
              >
                <Form.Item
                  label="Work email"
                  name="email"
                  rules={[
                    { required: true, message: 'Enter your email address.' },
                    { type: 'email', message: 'Enter a valid email address.' },
                  ]}
                >
                  <Input
                    autoComplete="username"
                    size="large"
                    prefix={<MailOutlined />}
                    placeholder="you@company.com"
                    disabled={busy}
                  />
                </Form.Item>
                <Form.Item
                  label="Password"
                  name="password"
                  rules={[
                    { required: true, message: 'Enter your password.' },
                    { max: 256, message: 'Password must be 256 characters or fewer.' },
                  ]}
                >
                  <Input.Password
                    autoComplete="current-password"
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="Enter your password"
                    disabled={busy}
                  />
                </Form.Item>
                <Button
                  className="auth-submit"
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={busy}
                  icon={!loading && <ArrowRightOutlined />}
                  iconPlacement="end"
                >
                  Sign in to your workspace
                </Button>
              </Form>
            )}
            {mode === 'register' && (
              <Form<RegistrationFormValues>
                layout="vertical"
                requiredMark={false}
                scrollToFirstError
                onFinish={handleRegister}
                onValuesChange={clearSignInError}
              >
                <Form.Item
                  label="Full name"
                  name="fullName"
                  rules={[
                    { required: true, message: 'Enter your name.' },
                    { min: 2, max: 120, message: 'Use 2 to 120 characters.' },
                  ]}
                >
                  <Input
                    autoComplete="name"
                    size="large"
                    prefix={<TeamOutlined />}
                    placeholder="Your name"
                    disabled={busy}
                  />
                </Form.Item>
                <Form.Item
                  label="Work email"
                  name="email"
                  rules={[
                    { required: true, message: 'Enter your email address.' },
                    { type: 'email', message: 'Enter a valid email address.' },
                  ]}
                >
                  <Input
                    autoComplete="email"
                    size="large"
                    prefix={<MailOutlined />}
                    placeholder="you@company.com"
                    disabled={busy}
                  />
                </Form.Item>
                <Form.Item
                  label="Password"
                  name="password"
                  rules={[
                    { required: true, message: 'Create a password.' },
                    { min: 12, max: 256, message: 'Use 12 to 256 characters.' },
                  ]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="At least 12 characters"
                    disabled={busy}
                  />
                </Form.Item>
                <Form.Item
                  label="Confirm password"
                  name="confirmPassword"
                  dependencies={['password']}
                  rules={[
                    { required: true, message: 'Confirm your password.' },
                    ({ getFieldValue }) => ({
                      validator(_, value: string) {
                        return !value || getFieldValue('password') === value
                          ? Promise.resolve()
                          : Promise.reject(new Error('Passwords do not match.'));
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="Enter it again"
                    disabled={busy}
                  />
                </Form.Item>
                <Button
                  className="auth-submit"
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={busy}
                  icon={!busy && <ArrowRightOutlined />}
                  iconPlacement="end"
                >
                  Create account
                </Button>
              </Form>
            )}
            {mode === 'forgot' && (
              <Form<EmailFormValues>
                layout="vertical"
                requiredMark={false}
                onFinish={handleEmailRequest}
                onValuesChange={clearSignInError}
              >
                <Form.Item
                  label="Work email"
                  name="email"
                  rules={[
                    { required: true, message: 'Enter your email address.' },
                    { type: 'email', message: 'Enter a valid email address.' },
                  ]}
                >
                  <Input
                    autoComplete="email"
                    size="large"
                    prefix={<MailOutlined />}
                    placeholder="you@company.com"
                    disabled={busy}
                  />
                </Form.Item>
                <Button
                  className="auth-submit"
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={busy}
                  icon={!busy && <ArrowRightOutlined />}
                  iconPlacement="end"
                >
                  {mode === 'forgot' ? 'Send reset link' : 'Send verification link'}
                </Button>
              </Form>
            )}
            {mode === 'verify' && (
              <Button
                className="auth-submit"
                type="primary"
                size="large"
                block
                loading={busy}
                onClick={handleVerifyEmail}
                disabled={!token}
                icon={!busy && <CheckCircleFilled />}
              >
                Verify email address
              </Button>
            )}
            {mode === 'reset' && (
              <Form<ResetFormValues>
                layout="vertical"
                requiredMark={false}
                onFinish={handleResetPassword}
                onValuesChange={clearSignInError}
              >
                <Form.Item
                  label="New password"
                  name="password"
                  rules={[
                    { required: true, message: 'Enter a new password.' },
                    { min: 12, max: 256, message: 'Use 12 to 256 characters.' },
                  ]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="At least 12 characters"
                    disabled={busy}
                  />
                </Form.Item>
                <Form.Item
                  label="Confirm new password"
                  name="confirmPassword"
                  dependencies={['password']}
                  rules={[
                    { required: true, message: 'Confirm your new password.' },
                    ({ getFieldValue }) => ({
                      validator(_, value: string) {
                        return !value || getFieldValue('password') === value
                          ? Promise.resolve()
                          : Promise.reject(new Error('Passwords do not match.'));
                      },
                    }),
                  ]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="Enter it again"
                    disabled={busy}
                  />
                </Form.Item>
                <Button
                  className="auth-submit"
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={busy}
                  icon={!busy && <ArrowRightOutlined />}
                  iconPlacement="end"
                >
                  Update password
                </Button>
              </Form>
            )}
            {mode === 'signin' && (
              <div className="auth-links">
                <Link to={routes.forgotPassword}>Forgot password?</Link>
              </div>
            )}
            {mode === 'register' && (
              <div className="auth-links">
                <Link to={routes.signIn}>Already have an account? Sign in</Link>
              </div>
            )}
            {(mode === 'forgot' || mode === 'verify' || mode === 'reset') && (
              <div className="auth-links">
                <Link to={routes.signIn}>Back to sign in</Link>
              </div>
            )}
            {(mode === 'signin' || mode === 'register') && (
              <div className="auth-google-section">
                <div className="auth-divider">
                  <span>OR</span>
                </div>
                <div
                  ref={googleButtonRef}
                  className={`auth-google-button${busy ? ' is-loading' : ''}`}
                >
                  <GoogleLogin
                    theme="outline"
                    size="large"
                    shape="rectangular"
                    text="continue_with"
                    width={googleButtonWidth}
                    onSuccess={(credentialResponse) =>
                      void handleGoogleSuccess(credentialResponse.credential)
                    }
                    onError={() => setSubmitError('Could not sign in with Google. Try again.')}
                  />
                </div>
              </div>
            )}
            {mode === 'signin' && import.meta.env.DEV && (
              <div className="demo-account">
                <Text>Just exploring?</Text>
                <Button type="link" onClick={fillDemoAccount} disabled={busy}>
                  Try the demo account
                </Button>
              </div>
            )}
            <div className="auth-security-note">
              <SafetyCertificateOutlined />
              <span>Private, secure sign-in</span>
            </div>
          </Card>
          <Text className="auth-footer">RecruitAI · Resume screening workspace</Text>
        </section>
      </div>
    </main>
  );
}
