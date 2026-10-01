export const routes = {
  home: '/',
  signIn: '/signin',
  screenings: '/screenings',
  screening: '/screening',
  newScreening: '/screening/new',
  ai: '/ai',
  notFound: '*',
} as const;

export function screeningDetailRoute(screeningId: string): string {
  return `${routes.screening}/${encodeURIComponent(screeningId)}`;
}
