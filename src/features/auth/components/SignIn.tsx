import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { GoogleLogin } from '@react-oauth/google';

const { Paragraph, Text, Title } = Typography;
const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'demo@recruitai.local';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || 'RecruitAI-Demo-2026!';

interface SignInProps {
  error?: string;
  loading: boolean;
  onClearError: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  onGoogleSignIn: (credential: string) => Promise<void>;
}

interface SignInFormValues {
  email: string;
  password: string;
}

export default function SignIn({
  error,
  loading,
  onClearError,
  onSubmit,
  onGoogleSignIn,
}: SignInProps) {
  const [form] = Form.useForm<SignInFormValues>();
  const [submitError, setSubmitError] = useState('');
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const visibleError = submitError || error;

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
    onClearError();
  };

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
              Welcome back
            </Title>
            <Paragraph className="auth-description">
              Sign in to continue to your hiring workspace.
            </Paragraph>
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
                  disabled={loading}
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
                  disabled={loading}
                />
              </Form.Item>
              <Button
                className="auth-submit"
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                icon={!loading && <ArrowRightOutlined />}
                iconPlacement="end"
              >
                Sign in to your workspace
              </Button>
            </Form>
            <div className="auth-google-section">
              <div className="auth-divider">
                <span>OR</span>
              </div>
              <div
                ref={googleButtonRef}
                className={`auth-google-button${loading ? ' is-loading' : ''}`}
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
            {import.meta.env.DEV && (
              <div className="demo-account">
                <Text>Just exploring?</Text>
                <Button type="link" onClick={fillDemoAccount} disabled={loading}>
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
