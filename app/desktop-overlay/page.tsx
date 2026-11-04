import { DesktopOverlayVisual } from './DesktopOverlayVisual';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function DesktopOverlayPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const logoParam = readParam(params, 'logo');
  const logo = logoParam === 'logo2' ? 'logo2' : 'logo';
  const muted = readParam(params, 'muted') === '1';

  return <DesktopOverlayVisual initialLogo={logo} initiallyMuted={muted} />;
}
