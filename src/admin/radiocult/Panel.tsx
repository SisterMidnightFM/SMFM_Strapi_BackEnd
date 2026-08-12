/**
 * "Upload to Soundcloud/Mixcloud/Radio Cult" side panel on the episode edit
 * page. All uploading/publishing
 * happens on the dedicated uploader page (opened in a new tab) — this panel
 * just shows where the episode has got to and provides the button to open it.
 */

import * as React from 'react';
import { Button, Divider, Flex, Typography } from '@strapi/design-system';
import { getFetchClient } from '@strapi/strapi/admin';

const EPISODE_MODEL = 'api::episode.episode';

interface PlatformStatus {
  state: 'not_published' | 'publishing' | 'linked' | 'stalled';
  requestedAt: string | null;
  link: string | null;
}
interface RcStatus {
  enabled: boolean;
  trackId: string | null;
  uploadedAt: string | null;
  platforms: { mixcloud: PlatformStatus; soundcloud: PlatformStatus };
  rateLimitMessage?: string | null;
}

const errorMessage = (error: any): string =>
  error?.response?.data?.error ?? error?.message ?? 'Something went wrong';

/**
 * The side panel is a narrow column, so long unbroken strings (URLs, ids)
 * would otherwise push it wide or spill out of the box.
 */
const WRAP = { overflowWrap: 'anywhere', minWidth: 0 } as const;

/**
 * Display form of a published link: host + path, no scheme and no query
 * string (SoundCloud appends a long utm_* tail), clipped to fit the panel.
 * The full URL still opens on click and shows in the tooltip.
 */
const shortLink = (url: string): string => {
  let text = url;
  try {
    const parsed = new URL(url);
    text = parsed.host.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
  } catch {
    /* not a parseable URL — clip the raw string instead */
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

const PlatformLine = ({ label, status }: { label: string; status: PlatformStatus }) => (
  <Flex direction="column" alignItems="stretch" gap={0} style={{ minWidth: 0 }}>
    <Typography variant="sigma" textColor="neutral600">
      {label}
    </Typography>
    {status.state === 'linked' && status.link ? (
      <a
        href={status.link}
        target="_blank"
        rel="noreferrer"
        title={status.link}
        style={{ display: 'block', minWidth: 0 }}
      >
        <Typography variant="pi" textColor="primary600" ellipsis>
          {shortLink(status.link)}
        </Typography>
      </a>
    ) : (
      <Typography
        variant="pi"
        textColor={status.state === 'stalled' ? 'danger600' : 'neutral600'}
        style={WRAP}
      >
        {status.state === 'publishing'
          ? 'Publishing… link is saved automatically'
          : status.state === 'stalled'
            ? 'No link after 7 days — publish again from the uploader'
            : 'Not published'}
      </Typography>
    )}
  </Flex>
);

const PanelContent = ({ documentId }: { documentId: string }) => {
  // Standalone page served from public/ on the same origin as the admin —
  // it picks the admin session up from localStorage / the jwtToken cookie.
  const backendURL = (window as any).strapi?.backendURL ?? window.location.origin;
  const uploaderHref = `${backendURL}/radiocult-uploader.html?id=${documentId}`;

  const [status, setStatus] = React.useState<RcStatus | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);

  const fetchStatus = React.useCallback(
    async (refresh = false) => {
      const { get } = getFetchClient();
      try {
        const { data } = await get(
          `/radiocult/episodes/${documentId}/status${refresh ? '?refresh=true' : ''}`
        );
        setStatus(data);
        setMessage(data.rateLimitMessage ?? null);
      } catch (error) {
        setMessage(errorMessage(error));
      }
    },
    [documentId]
  );

  React.useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    // content-manager wraps every side panel in a Flex with
    // alignItems="flex-start", so a child sizes to its own content and any long
    // line (or a fullWidth Button) pushes straight out of the panel box.
    // width:100% pins us to the panel instead; minWidth:0 lets the text shrink.
    <Flex
      direction="column"
      alignItems="stretch"
      gap={3}
      style={{ width: '100%', minWidth: 0 }}
    >
      {!status ? (
        <Typography textColor="neutral600">Loading…</Typography>
      ) : !status.enabled ? (
        <Typography textColor="neutral600" style={WRAP}>
          Radio Cult uploads are switched off — check RADIOCULT_ENABLED, RADIOCULT_API_KEY and
          RADIOCULT_STATION_ID on the server.
        </Typography>
      ) : (
        <>
          <Typography
            variant="pi"
            textColor={status.trackId ? 'success600' : 'neutral600'}
            style={WRAP}
          >
            {status.trackId
              ? `✓ Uploaded to Radio Cult${
                  status.uploadedAt
                    ? ` on ${new Date(status.uploadedAt).toLocaleDateString('en-GB')}`
                    : ''
                }`
              : 'Not uploaded to Radio Cult yet'}
          </Typography>
          <PlatformLine label="Mixcloud" status={status.platforms.mixcloud} />
          <PlatformLine label="SoundCloud" status={status.platforms.soundcloud} />
          <Divider />
        </>
      )}
      <Button fullWidth onClick={() => window.open(uploaderHref, '_blank', 'noopener')}>
        Open Episode uploader
      </Button>
      {status?.trackId ? (
        <Button
          variant="tertiary"
          fullWidth
          loading={checking}
          onClick={async () => {
            setChecking(true);
            await fetchStatus(true);
            setChecking(false);
          }}
        >
          Check for links now
        </Button>
      ) : null}
      <Typography variant="pi" textColor="neutral600" style={WRAP}>
        Mixcloud/SoundCloud links are added to this episode automatically once Radio Cult
        finishes — reload this page to see them in the form fields.
      </Typography>
      {message ? (
        <Typography textColor="danger600" style={WRAP}>
          {message}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * PanelComponent for content-manager's addEditViewSidePanel. Called as a
 * plain function during render — it must not use hooks itself; everything
 * stateful lives in PanelContent.
 */
// content-manager renders the panel title itself (uppercase sigma, no wrapping
// styles we can reach), and "Soundcloud/Mixcloud/Radio" is one unbreakable
// token — browsers offer no line break after "/". The zero-width spaces give
// it somewhere to wrap in the narrow panel; they render as nothing.
const PANEL_TITLE = 'Upload to Soundcloud/​Mixcloud/​Radio Cult';

export const RadioCultPanel = (props: { model: string; documentId?: string }) => {
  if (props.model !== EPISODE_MODEL) return null;
  if (!props.documentId) {
    return {
      title: PANEL_TITLE,
      content: (
        <Typography textColor="neutral600" style={{ ...WRAP, width: '100%' }}>
          Save the episode first — the uploader button appears here once it's saved.
        </Typography>
      ),
    };
  }
  return {
    title: PANEL_TITLE,
    content: <PanelContent documentId={props.documentId} />,
  };
};
