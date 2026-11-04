import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { adminApi } from '../../shared/admin-api.ts';
import { Page, PageHeader } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, Icon } from '../../shared/ui/primitives.tsx';
import { SkeletonCard } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { ConfirmButton, ErrorNote } from './studio-ui.tsx';

/**
 * Connecting the club's Google Drive.
 *
 * One account — the one with the storage — is connected here, once. After
 * that, every lesson gets "Upload to Drive" and "Choose from Drive", and so
 * does the library. The page says plainly what the app can and cannot reach
 * in that account, because "connect your Drive" with no further detail reads
 * as "hand over everything", and it is nothing like that.
 */

/** What Google sent the browser back with, read once and then cleared. */
function useCallbackResult() {
  const [result] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const drive = p.get('drive');
    return drive ? { drive, message: p.get('message') } : null;
  });
  useEffect(() => {
    if (!result) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('drive');
    url.searchParams.delete('message');
    window.history.replaceState(null, '', url.toString());
  }, [result]);
  return result;
}

export function AdminDrivePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const result = useCallbackResult();
  const status = useQuery({ queryKey: ['admin', 'drive'], queryFn: adminApi.driveStatus });

  useEffect(() => {
    if (result?.drive === 'connected') toast.show('Google Drive connected');
  }, [result, toast]);

  const connect = useMutation({
    mutationFn: adminApi.driveConnect,
    // A full navigation, not a popup: Google's consent screen is a page, and
    // popup blockers eat windows opened after an await.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: toast.error,
  });

  const disconnect = useMutation({
    mutationFn: adminApi.driveDisconnect,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'drive'] });
      toast.show('Google Drive disconnected');
    },
    onError: toast.error,
  });

  const s = status.data;

  return (
    <Page>
      <PageHeader title="Google Drive" back="/admin" crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Drive' }]} />

      {result?.drive === 'error' && (
        <div className="alert">
          Drive was not connected. {result.message ?? 'Try again.'}
        </div>
      )}
      {result?.drive === 'cancelled' && (
        <div className="callout">Connecting was cancelled at Google, so nothing changed.</div>
      )}
      <ErrorNote error={status.error} />

      {status.isPending ? (
        <SkeletonCard />
      ) : s && !s.configured ? (
        <Card>
          <h2 style={{ fontSize: 16, margin: 0 }}>Not set up on the server yet</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
            The API needs its Google credentials before an account can be connected: GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET, GOOGLE_API_KEY, GOOGLE_APP_ID and DRIVE_SECRET. Once they are set, this page
            offers the Connect button.
          </p>
        </Card>
      ) : s?.connected ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--green-tint, var(--soft))',
                color: 'var(--green, var(--ink))',
                flexShrink: 0,
              }}
            >
              <Icon name="cloud" size={22} />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Connected</h2>
                <Chip tone="green">
                  <Icon name="check" size={10} strokeWidth={3} />
                  Working
                </Chip>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{s.email}</div>
              {s.connectedAt && (
                <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Since {new Date(s.connectedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {s.folderUrl && (
                <a className="btn btn-soft" href={s.folderUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="expand" size={13} />
                  Open the folder
                </a>
              )}
              <button type="button" className="btn btn-ghost" disabled={connect.isPending} onClick={() => connect.mutate()}>
                Reconnect
              </button>
              <ConfirmButton
                label="Disconnect"
                confirmLabel="Disconnect — lessons on Drive stop playing"
                disabled={disconnect.isPending}
                onConfirm={() => disconnect.mutate()}
              />
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <h2 style={{ fontSize: 16, margin: 0 }}>Connect the club's Drive</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, margin: '6px 0 14px' }}>
            Sign in with the Google account that holds the course files. You only do this once, and any admin can
            then upload to it and choose files from it.
          </p>
          <div>
            <button type="button" className="btn btn-pink" disabled={connect.isPending} onClick={() => connect.mutate()}>
              <Icon name="cloud" size={14} />
              {connect.isPending ? 'Opening Google…' : 'Connect Google Drive'}
            </button>
          </div>
        </Card>
      )}

      <Card>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>What the app can reach</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 18 }} className="muted">
          <li>
            Only files uploaded through the studio, which go into an <strong>Eternal Bonds</strong> folder it creates,
            and files an admin picks with <strong>Choose from Drive</strong>. Nothing else in the account.
          </li>
          <li>
            Files stay private in Drive. Members never get a Drive link; they watch and download through the club,
            with links that expire, and only for what their membership includes.
          </li>
          <li>
            Removing a video from a lesson, or an item from the library, never deletes the file from Drive.
          </li>
          <li>
            For videos: Drive plays the original file, so export at 1080p or lower with "fast start" (Zoom
            recordings already are). Very popular files can hit Google's daily download limit — those are better on
            YouTube.
          </li>
        </ul>
      </Card>
    </Page>
  );
}
