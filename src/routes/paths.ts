export const routes = {
  home: '/',
  signIn: '/signin',
  register: '/register',
  forgotPassword: '/forgot-password',
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
  screenings: '/screenings',
  screening: '/screening',
  newScreening: '/screening/new',
  ai: '/ai',
  notFound: '*',
} as const;

export const publicAuthPaths: string[] = [
  routes.signIn,
  routes.register,
  routes.forgotPassword,
  routes.verifyEmail,
  routes.resetPassword,
];

export function screeningDetailRoute(screeningId: string): string {
  return `${routes.screening}/${encodeURIComponent(screeningId)}`;
}
