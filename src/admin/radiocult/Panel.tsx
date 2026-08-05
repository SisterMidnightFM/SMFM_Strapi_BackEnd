/**
 * "Radio Cult" side panel on the episode edit page: upload the episode audio
 * to Radio Cult, publish it onward to Mixcloud/SoundCloud, and watch the
 * final links get saved onto the episode.
 */

import * as React from 'react';
import { Box, Button, Divider, Flex, ProgressBar, Typography } from '@strapi/design-system';
import { getFetchClient, useAuth, useNotification } from '@strapi/strapi/admin';
import { uploadWithProgress, type UploadHandle } from './uploadWithProgress';

const EPISODE_MODEL = 'api::episode.episode';
const POLL_MS = 30_000;

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

const PlatformRow = ({
  label,
  status,
  busy,
  onPublish,
}: {
  label: string;
  status: PlatformStatus;
  busy: boolean;
  onPublish: () => void;
}) => (
  <Flex direction="column" alignItems="stretch" gap={1}>
    <Typography variant="sigma" textColor="neutral600">
      {label}
    </Typography>
    {status.state === 'linked' && status.link ? (
      <a href={status.link} target="_blank" rel="noreferrer">
        <Typography textColor="primary600" ellipsis>
          {status.link}
        </Typography>
      </a>
    ) : status.state === 'publishing' ? (
      <Typography textColor="neutral600">
        Publishing… requested {status.requestedAt ? new Date(status.requestedAt).toLocaleString('en-GB') : ''}.
        The link is saved automatically when Radio Cult finishes.
      </Typography>
    ) : status.state === 'stalled' ? (
      <>
        <Typography textColor="danger600">
          No link after 7 days — the transfer probably failed.
        </Typography>
        <Button variant="secondary" onClick={onPublish} loading={busy} fullWidth>
          Publish again
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={onPublish} loading={busy} fullWidth>
        Upload to {label}
      </Button>
    )}
  </Flex>
);

const PanelContent = ({ documentId }: { documentId: string }) => {
  const token = useAuth('RadioCultPanel', (auth) => auth.token);
  const { toggleNotification } = useNotification();

  const [status, setStatus] = React.useState<RcStatus | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [publishing, setPublishing] = React.useState<string | null>(null);
  const uploadRef = React.useRef<UploadHandle | null>(null);

  const fetchStatus = React.useCallback(
    async (refresh = false) => {
      const { get } = getFetchClient();
      try {
        const { data } = await get(
          `/radiocult/episodes/${documentId}/status${refresh ? '?refresh=true' : ''}`
        );
        setStatus(data);
        if (data.rateLimitMessage) setMessage(data.rateLimitMessage);
        return data as RcStatus;
      } catch (error) {
        setMessage(errorMessage(error));
        return null;
      }
    },
    [documentId]
  );

  React.useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const anyPublishing =
    status?.platforms &&
    Object.values(status.platforms).some((platform) => platform.state === 'publishing');

  React.useEffect(() => {
    if (!anyPublishing) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchStatus();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [anyPublishing, fetchStatus]);

  const startUpload = async (force = false) => {
    if (!file || !token) return;
    setMessage(null);
    setWarnings([]);
    setUploading(true);
    setUploadPct(0);
    try {
      const handle = uploadWithProgress({
        path: `/radiocult/episodes/${documentId}/upload${force ? '?force=true' : ''}`,
        token,
        file,
        onProgress: setUploadPct,
      });
      uploadRef.current = handle;
      const result = await handle.promise;
      setWarnings(result.warnings ?? []);
      setFile(null);
      toggleNotification({ type: 'success', message: 'Episode uploaded to Radio Cult' });
      await fetchStatus();
    } catch (error: any) {
      if (error?.status === 409 && !force) {
        if (
          window.confirm(
            `${errorMessage(error)}\n\nReplace it with the new file? The old track stays in the Radio Cult library until you delete it there.`
          )
        ) {
          setUploading(false);
          return startUpload(true);
        }
      } else if (!error?.cancelled) {
        setMessage(errorMessage(error));
        toggleNotification({ type: 'danger', message: 'Upload to Radio Cult failed' });
      }
    } finally {
      uploadRef.current = null;
      setUploading(false);
      setUploadPct(null);
    }
  };

  const publish = async (platform: 'mixcloud' | 'soundcloud', force = false) => {
    const { post } = getFetchClient();
    setMessage(null);
    setPublishing(platform);
    try {
      await post(
        `/radiocult/episodes/${documentId}/publish/${platform}${force ? '?force=true' : ''}`
      );
      toggleNotification({
        type: 'success',
        message: `Publish to ${platform} requested — the link will be saved automatically once it's live`,
      });
      await fetchStatus();
    } catch (error: any) {
      if (error?.response?.status === 409 && !force) {
        if (window.confirm(`${errorMessage(error)}\n\nSend the request anyway?`)) {
          setPublishing(null);
          return publish(platform, true);
        }
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPublishing(null);
    }
  };

  if (!status) {
    return <Typography textColor="neutral600">Loading…</Typography>;
  }
  if (!status.enabled) {
    return (
      <Typography textColor="neutral600">
        Radio Cult uploads are switched off — check RADIOCULT_ENABLED, RADIOCULT_API_KEY and
        RADIOCULT_STATION_ID on the server.
      </Typography>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {!status.trackId ? (
        <>
          <Typography textColor="neutral600">
            Upload this episode's audio (.mp3 or .m4a). Title and image are taken from the saved
            episode, so save any changes first.
          </Typography>
          <input
            type="file"
            accept=".mp3,.m4a,audio/mpeg,audio/mp4"
            disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {uploading ? (
            <Flex direction="column" alignItems="stretch" gap={2}>
              {uploadPct !== null ? (
                <>
                  <ProgressBar value={uploadPct} />
                  <Typography textColor="neutral600">Sending file… {uploadPct}%</Typography>
                </>
              ) : (
                <Typography textColor="neutral600">
                  Sending to Radio Cult… this can take a while for big files.
                </Typography>
              )}
              <Button variant="danger-light" onClick={() => uploadRef.current?.abort()} fullWidth>
                Cancel
              </Button>
            </Flex>
          ) : (
            <Button onClick={() => startUpload()} disabled={!file || !token} fullWidth>
              Upload to Radio Cult
            </Button>
          )}
        </>
      ) : (
        <>
          <Typography textColor="neutral600">
            Track on Radio Cult
            {status.uploadedAt
              ? ` — uploaded ${new Date(status.uploadedAt).toLocaleString('en-GB')}`
              : ''}
          </Typography>
          <PlatformRow
            label="Mixcloud"
            status={status.platforms.mixcloud}
            busy={publishing === 'mixcloud'}
            onPublish={() => publish('mixcloud')}
          />
          <PlatformRow
            label="SoundCloud"
            status={status.platforms.soundcloud}
            busy={publishing === 'soundcloud'}
            onPublish={() => publish('soundcloud')}
          />
          <Divider />
          <Button
            variant="tertiary"
            loading={checking}
            fullWidth
            onClick={async () => {
              setChecking(true);
              await fetchStatus(true);
              setChecking(false);
            }}
          >
            Check for links now
          </Button>
          {!uploading ? (
            <>
              <input
                type="file"
                accept=".mp3,.m4a,audio/mpeg,audio/mp4"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <Button
                variant="danger-light"
                disabled={!file || !token}
                onClick={() => startUpload()}
                fullWidth
              >
                Replace track
              </Button>
            </>
          ) : (
            <Typography textColor="neutral600">
              {uploadPct !== null ? `Sending file… ${uploadPct}%` : 'Sending to Radio Cult…'}
            </Typography>
          )}
        </>
      )}
      {warnings.map((warning) => (
        <Typography key={warning} textColor="warning600">
          {warning}
        </Typography>
      ))}
      {message ? <Typography textColor="danger600">{message}</Typography> : null}
    </Flex>
  );
};

/**
 * PanelComponent for content-manager's addEditViewSidePanel. Called as a
 * plain function during render — it must not use hooks itself; everything
 * stateful lives in PanelContent.
 */
export const RadioCultPanel = (props: { model: string; documentId?: string }) => {
  if (props.model !== EPISODE_MODEL || !props.documentId) return null;
  return {
    title: 'Radio Cult',
    content: <PanelContent documentId={props.documentId} />,
  };
};
