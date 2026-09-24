import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../shared/api.ts';
import { PageHeader, Page } from '../../shared/layout/AppShell.tsx';
import { Card, Chip, EmptyState } from '../../shared/ui/primitives.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { Select } from '../../shared/ui/Select.tsx';
import { adminApi } from '../../shared/admin-api.ts';
import { ConfirmButton, Field } from './studio-ui.tsx';

/** Studio → Moderation: reports queue, audit log, feature flags, event scheduler. */
export function ModerationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const reports = useQuery({ queryKey: ['reports'], queryFn: api.reports });
  const pending = useQuery({ queryKey: ['pending-wins'], queryFn: api.pendingWins });
  const audit = useQuery({ queryKey: ['audit'], queryFn: api.audit });
  const flags = useQuery({ queryKey: ['flags'], queryFn: api.flags });
  const [event, setEvent] = useState({ slug: '', title: '', startsAt: '', endsAt: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'published' | 'hidden' }) => {
      await api.reviewWin(id, status);
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['pending-wins'] });
      qc.invalidateQueries({ queryKey: ['wins'] });
      toast.show(vars.status === 'published' ? 'Win approved and published' : 'Win hidden');
    },
    onError: toast.error,
  });

  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'actioned' | 'dismissed' }) =>
      api.resolveReport(id, status),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.show(vars.status === 'actioned' ? 'Report actioned' : 'Report dismissed');
    },
    onError: toast.error,
  });

  // Sessions that have finished and have no recording attached yet — the last
  // leg of the Think Tank loop, which had an endpoint and no way to call it.
  const events = useQuery({ queryKey: ['events'], queryFn: api.events });
  const courses = useQuery({ queryKey: ['courses', 'all'], queryFn: () => api.courses('all') });
  const [promote, setPromote] = useState({ eventId: '', courseSlug: '', lessonId: '' });

  // The lesson list comes from whichever course the admin picked. Loading
  // every lesson in the catalogue into one dropdown would be 572 options.
  const source = useQuery({
    queryKey: ['course', promote.courseSlug],
    queryFn: () => api.course(promote.courseSlug),
    enabled: promote.courseSlug !== '',
  });
  const lessonOptions = (source.data?.modules ?? []).flatMap((m) =>
    m.lessons.map((l) => ({ id: l.id, label: `${m.title} · ${l.title}` })),
  );

  const setFlag = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.setFlag(key, enabled),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['flags'] });
      toast.show(`${vars.key} turned ${vars.enabled ? 'on' : 'off'}`);
    },
    onError: toast.error,
  });

  const attachRecording = useMutation({
    mutationFn: () => api.promoteRecording(promote.eventId, promote.lessonId),
    onSuccess: () => {
      setPromote({ eventId: '', courseSlug: '', lessonId: '' });
      qc.invalidateQueries({ queryKey: ['events'] });
      setMsg('Recording attached.');
    },
  });

  const openReports = (reports.data ?? []).filter((r: { status: string }) => r.status === 'open');
  const pendingWins = pending.data ?? [];

  return (
    <Page>
      <PageHeader title="Moderation" crumbs={[{ label: 'Studio', to: '/admin' }, { label: 'Moderation' }]} />
      <span className="section-label">Wins awaiting review</span>
      {pendingWins.map((w: { id: string; title: string; bigIdeaMd: string; authorName: string }) => (
        <Card key={w.id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 220 }}>
              <strong style={{ fontSize: 12 }}>{w.title}</strong>
              <span style={{ display: 'block', fontSize: 11 }} className="muted">
                by {w.authorName} · {w.bigIdeaMd.slice(0, 140)}
              </span>
            </span>
            <button className="btn btn-soft" disabled={review.isPending}
              onClick={() => review.mutate({ id: w.id, status: 'hidden' })}>Hide</button>
            <button className="btn btn-pink" disabled={review.isPending} style={{ color: '#fff' }}
              onClick={() => review.mutate({ id: w.id, status: 'published' })}>Publish</button>
          </div>
        </Card>
      ))}
      {pendingWins.length === 0 && !pending.isPending && (
        <Card>
          <EmptyState
            icon="check"
            title="No wins waiting"
            hint="First wins from a member go through review here. After that they auto-approve."
          />
        </Card>
      )}
      <span className="section-label">Reports queue</span>
      {openReports.map((r: { id: string; targetType: string; reason: string }) => (
        <Card key={r.id}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 12 }}><strong>{r.targetType}</strong> · {r.reason}</span>
            <button className="btn btn-soft" onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</button>
            <button className="btn btn-pink" onClick={() => resolve.mutate({ id: r.id, status: 'actioned' })}>Action</button>
          </div>
        </Card>
      ))}
      {openReports.length === 0 && (
        <Card>
          <EmptyState
            icon="check"
            title="Queue is clear"
            hint="Reports land here when a member flags a post, a win or somebody's behaviour."
          />
        </Card>
      )}

      <span className="section-label">Schedule live session</span>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder="slug" value={event.slug} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, slug: e.target.value })} aria-label="Event slug" />
          <input className="input" placeholder="Title" value={event.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, title: e.target.value })} aria-label="Event title" />
          <input className="input" type="datetime-local" value={event.startsAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, startsAt: e.target.value })} aria-label="Starts at" />
          <input className="input" type="datetime-local" value={event.endsAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEvent({ ...event, endsAt: e.target.value })} aria-label="Ends at" />
          <button className="btn btn-pink" onClick={() =>
            api.createEvent({
              slug: event.slug, title: event.title,
              startsAt: new Date(event.startsAt).toISOString(), endsAt: new Date(event.endsAt).toISOString(),
              descriptionMd: null, joinUrl: null, minTier: 'free', isFeaturedSession: false, insightIds: [],
            }).then(() => setMsg('Scheduled.')).catch((e) => setMsg(e.message))}>Schedule</button>
        </div>
        {msg && <p style={{ fontSize: 12 }}>{msg}</p>}
      </Card>

      <span className="section-label">Session recordings</span>
      <Card>
        <span style={{ fontSize: 11, lineHeight: 1.6 }} className="muted">
          The last step of the weekly loop. Upload the recording as a lesson in a course first, then attach it
          here — the session stops being an hour that happened and becomes something a member who joined in
          March can still watch.
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select
            aria-label="Session"
            value={promote.eventId}
            placeholder="Finished session…"
            options={(events.data ?? [])
              .filter((e) => new Date(e.endsAt).getTime() < Date.now() && !e.recordingLessonId)
              .map((e) => ({ value: e.id, label: e.title }))}
            onChange={(eventId) => setPromote({ ...promote, eventId })}
          />

          <Select
            aria-label="Course holding the recording"
            value={promote.courseSlug}
            placeholder="Course…"
            options={(courses.data ?? []).map((c) => ({ value: c.slug, label: c.title }))}
            onChange={(courseSlug) => setPromote({ ...promote, courseSlug, lessonId: '' })}
          />

          <Select
            aria-label="Recording lesson"
            disabled={promote.courseSlug === ''}
            value={promote.lessonId}
            placeholder="Lesson holding the recording…"
            options={lessonOptions.map((l) => ({ value: l.id, label: l.label }))}
            onChange={(lessonId) => setPromote({ ...promote, lessonId })}
          />

          <button
            className="btn btn-pink"
            disabled={!promote.eventId || !promote.lessonId || attachRecording.isPending}
            onClick={() => attachRecording.mutate()}
          >
            {attachRecording.isPending ? 'Attaching…' : 'Attach recording'}
          </button>
        </div>
        {attachRecording.error && (
          <span className="field-error">{(attachRecording.error as Error).message}</span>
        )}
      </Card>

      <span className="section-label">Channel moderators</span>
      <Moderators />

      <span className="section-label">Feature flags</span>
      {(flags.data ?? []).length === 0 && (
        <Card>
          <EmptyState
            icon="settings"
            title="No feature flags"
            hint="Flags are kill switches for a feature without a deploy. They appear once one is defined."
          />
        </Card>
      )}
      {(flags.data ?? []).map((f: { key: string; enabled: boolean }) => (
        <Card key={f.key}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 12 }}>
              <strong>{f.key}</strong>
              <span className="dim" style={{ marginLeft: 8, fontSize: 11 }}>
                {f.enabled ? 'on' : 'off'}
              </span>
            </span>
            {/* A kill switch that can only be read is not a kill switch. */}
            <button
              className={f.enabled ? 'btn btn-soft' : 'btn btn-pink'}
              disabled={setFlag.isPending}
              onClick={() => setFlag.mutate({ key: f.key, enabled: !f.enabled })}
            >
              Turn {f.enabled ? 'off' : 'on'}
            </button>
          </div>
        </Card>
      ))}

      <span className="section-label">Audit log</span>
      {(audit.data ?? []).slice(0, 20).map((a: { id: string; action: string; actorName: string | null; targetType: string | null }) => (
        <Card key={a.id}>
          <span style={{ fontSize: 12 }}><strong>{a.action}</strong> by {a.actorName ?? 'system'} · {a.targetType ?? ''}</span>
        </Card>
      ))}
    </Page>
  );
}

/**
 * Who moderates which channel.
 *
 * Granting has been possible since moderation shipped and nothing listed or
 * revoked, so the obvious button — "make this person a moderator" — would have
 * handed out a permission that nothing displayed and nobody could take back. A
 * permission you cannot see is a permission you cannot audit, and the audit log
 * two sections down is the whole argument for having one.
 */
function Moderators() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [channelId, setChannelId] = useState('');
  const [memberId, setMemberId] = useState('');

  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels });
  const moderators = useQuery({ queryKey: ['moderators'], queryFn: api.moderators });
  // The roster, so a moderator is chosen from a list rather than by pasting a
  // uuid — which is what any "userId" field really asks for.
  const members = useQuery({ queryKey: ['admin', 'members', 'all'], queryFn: () => adminApi.members() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['moderators'] });

  const grant = useMutation({
    mutationFn: () => api.addModerator(channelId, memberId),
    onSuccess: () => {
      refresh();
      setMemberId('');
      toast.show('Moderator added');
    },
    onError: toast.error,
  });
  const revoke = useMutation({
    mutationFn: (v: { channelId: string; userId: string }) => api.removeModerator(v.channelId, v.userId),
    onSuccess: () => {
      refresh();
      toast.show('Moderator removed');
    },
    onError: toast.error,
  });

  const roster = members.data?.items ?? [];
  const rows = moderators.data ?? [];

  return (
    <Card>
      <div className="field-row">
        <Field label="Channel">
          <Select
            value={channelId}
            options={[
              { value: '', label: 'Pick a channel…' },
              ...(channels.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
            onChange={setChannelId}
          />
        </Field>
        <Field label="Member">
          <Select
            value={memberId}
            options={[
              { value: '', label: 'Pick a member…' },
              ...roster.map((m) => ({ value: m.id, label: `${m.fullName} · ${m.email}` })),
            ]}
            onChange={setMemberId}
          />
        </Field>
        <button
          className="btn btn-pink"
          disabled={!channelId || !memberId || grant.isPending}
          onClick={() => grant.mutate()}
        >
          Add moderator
        </button>
      </div>

      {rows.length === 0 ? (
        <span style={{ fontSize: 11.5 }} className="muted">
          Nobody moderates a channel yet. Moderators can remove posts and comments in the channels they hold.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((m) => (
            <div key={`${m.channelId}:${m.userId}`} className="card-row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                {m.fullName}
                <span className="dim" style={{ marginLeft: 8, fontSize: 10.5 }}>
                  {m.email}
                </span>
              </span>
              <Chip tone="blue">{m.channelName}</Chip>
              <ConfirmButton
                label="Remove"
                confirmLabel="Remove them"
                style={{ fontSize: 10, color: 'var(--red)' }}
                disabled={revoke.isPending}
                onConfirm={() => revoke.mutate({ channelId: m.channelId, userId: m.userId })}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
