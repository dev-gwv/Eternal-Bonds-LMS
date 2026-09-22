import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../shared/api.ts';
import { Avatar, Chip, Icon } from '../shared/ui/primitives.tsx';

/**
 * First-run setup.
 *
 * The checklist on the dashboard told a member what to do and then left them
 * to go and do it, one page at a time, navigating back each time. That is five
 * round trips through an app they have never seen. This is the same five
 * things as one flow, which is how every SaaS product does first-run for the
 * same reason: the moment of highest intent is the first ninety seconds, and
 * spending it on navigation wastes it.
 *
 * Three rules it follows.
 *
 * **Every step is skippable, including all of them.** A setup wizard a member
 * cannot leave is a hostage situation, and the people who most want out are
 * the ones who already know what they want — exactly the members worth
 * keeping. Skip is a real button on every screen, not a greyed-out link.
 *
 * **Nothing is lost by skipping.** Each step writes as it completes, so a
 * member who does two and leaves has those two saved. There is no final
 * "submit" that discards the rest.
 *
 * **It never appears twice.** Finishing sets `onboarding_completed_at` and
 * skipping sets `onboarding_dismissed_at`, both server-side, so it does not
 * come back on their phone as though the app had forgotten them.
 */

type StepId = 'profile' | 'craft' | 'intro' | 'path' | 'done';

const ORDER: StepId[] = ['profile', 'craft', 'intro', 'path', 'done'];

const TITLES: Record<StepId, { title: string; sub: string }> = {
  profile: { title: 'Who are you?', sub: 'The basics. Members reply to people, not to initials.' },
  craft: { title: 'What do you shoot?', sub: 'So the right people can find you in the directory.' },
  intro: { title: 'Say hello', sub: 'Introductions get more replies than anything else here.' },
  path: { title: 'Where do you want to get to?', sub: 'Pick a path and we will sequence the courses.' },
  done: { title: 'That is it.', sub: 'You can change any of this later in Account settings.' },
};

export function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<StepId>('profile');

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const profile = useQuery({ queryKey: ['my-profile'], queryFn: api.myProfile, retry: false });
  const journeys = useQuery({ queryKey: ['journeys'], queryFn: api.journeys, retry: false });

  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [expertise, setExpertise] = useState('');
  const [listed, setListed] = useState(true);
  const [intro, setIntro] = useState('');

  // Prefill from whatever already exists — a member who signed in with Google
  // already has a name, and asking for it again looks like the app was not
  // paying attention.
  useEffect(() => {
    if (me.data) {
      setFullName((v) => v || me.data.fullName);
      setCity((v) => v || me.data.city || '');
    }
  }, [me.data]);

  useEffect(() => {
    if (profile.data) {
      setBio((v) => v || profile.data.bioMd || '');
      setExpertise((v) => v || profile.data.expertise.join(', '));
    }
  }, [profile.data]);

  const tags = expertise
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);

  const index = ORDER.indexOf(step);
  const next = () => setStep(ORDER[Math.min(index + 1, ORDER.length - 1)]!);

  const finish = (dismiss: boolean) => {
    const done = async () => {
      if (dismiss) await api.dismissOnboarding();
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate({ to: '/' });
    };
    void done();
  };

  const saveProfile = useMutation({
    mutationFn: () => api.updateProfile({ fullName: fullName.trim(), city: city.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      next();
    },
  });

  const saveCraft = useMutation({
    mutationFn: () =>
      api.saveMyProfile({ bioMd: bio.trim() || null, expertise: tags, showInDirectory: listed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      next();
    },
  });

  const postIntro = useMutation({
    mutationFn: () => api.createPost({ channelSlug: 'introductions', bodyMd: intro.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      next();
    },
  });

  const body = () => {
    switch (step) {
      case 'profile':
        return (
          <>
            <Field label="Your name">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
            </Field>
            <Field label="Which city do you work in?">
              <input value={city} placeholder="Jaipur" onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Actions
              primary="Continue"
              disabled={fullName.trim().length < 2 || saveProfile.isPending}
              busy={saveProfile.isPending}
              onPrimary={() => saveProfile.mutate()}
              onSkip={next}
              error={saveProfile.error}
            />
          </>
        );

      case 'craft':
        return (
          <>
            <Field label="A line about your work">
              <textarea
                rows={3}
                value={bio}
                placeholder="Wedding and portrait work out of Jaipur. Six years in, mostly destination weddings."
                onChange={(e) => setBio(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="What you shoot, separated by commas">
              <input
                value={expertise}
                placeholder="weddings, portraits, lighting"
                onChange={(e) => setExpertise(e.target.value)}
              />
            </Field>
            {tags.length > 0 && (
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tags.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </span>
            )}
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={listed}
                onChange={(e) => setListed(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                List me in the member directory
                <span style={{ display: 'block', fontSize: 10.5 }} className="dim">
                  Other members can find you by city or by what you shoot. You can turn this off any time.
                </span>
              </span>
            </label>
            <Actions
              primary="Continue"
              disabled={saveCraft.isPending}
              busy={saveCraft.isPending}
              onPrimary={() => saveCraft.mutate()}
              onSkip={next}
              error={saveCraft.error}
            />
          </>
        );

      case 'intro':
        return (
          <>
            <Field label="Your introduction">
              <textarea
                rows={4}
                value={intro}
                placeholder={`Hi, I'm ${fullName.split(' ')[0] || 'there'}${
                  city ? ` from ${city}` : ''
                }. I shoot ${tags[0] ?? 'weddings'} and I'm here to…`}
                onChange={(e) => setIntro(e.target.value)}
                autoFocus
              />
            </Field>
            <span style={{ fontSize: 11, lineHeight: 1.6 }} className="muted">
              This goes in the Introductions channel. Members reply to these more than to anything else
              on the platform — it is the cheapest way to know somebody before you need them.
            </span>
            <Actions
              primary="Post it"
              disabled={intro.trim().length < 4 || postIntro.isPending}
              busy={postIntro.isPending}
              onPrimary={() => postIntro.mutate()}
              onSkip={next}
              error={postIntro.error}
            />
          </>
        );

      case 'path': {
        const list = journeys.data ?? [];
        return (
          <>
            {list.length === 0 ? (
              <span style={{ fontSize: 12, lineHeight: 1.7 }} className="muted">
                No paths are published yet. The course library is open in the meantime — everything is
                there, it just does not tell you where to start.
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    className="card lift"
                    style={{ padding: '14px 16px', gap: 4, textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => navigate({ to: '/journeys/$slug', params: { slug: j.slug } })}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{j.title}</span>
                    <span style={{ fontSize: 11.5, lineHeight: 1.5 }} className="muted">
                      {j.promise}
                    </span>
                    <span style={{ fontSize: 10 }} className="dim num">
                      {j.stepCount} course{j.stepCount === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Actions primary="Continue" onPrimary={next} onSkip={next} />
          </>
        );
      }

      case 'done':
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar initials={me.data?.initials ?? '··'} size={48} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{fullName || me.data?.fullName}</span>
                <span style={{ fontSize: 11.5 }} className="muted">
                  {[city, tags.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'Welcome in'}
                </span>
              </div>
            </div>
            <span style={{ fontSize: 12, lineHeight: 1.7 }} className="muted">
              Anything you skipped is still on your dashboard as a short checklist, and it disappears
              once it is done.
            </span>
            <Actions primary="Go to my dashboard" onPrimary={() => finish(false)} />
          </>
        );
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px 16px',
        background: 'linear-gradient(180deg, #fdf7fa 0%, #ffffff 40%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Progress first: the honest answer to "how long is this going to
            take", which is the question somebody asks before step one. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {ORDER.slice(0, -1).map((id, i) => (
            <span
              key={id}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 999,
                background: i <= index ? 'var(--pink)' : 'var(--track)',
                transition: 'background 220ms ease',
              }}
            />
          ))}
          <span style={{ fontSize: 10.5, minWidth: 34, textAlign: 'right' }} className="dim num">
            {Math.min(index + 1, ORDER.length - 1)}/{ORDER.length - 1}
          </span>
        </div>

        <div className="card" style={{ padding: '26px 26px 22px', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>{TITLES[step].title}</h1>
            <span style={{ fontSize: 12.5, lineHeight: 1.6 }} className="muted">
              {TITLES[step].sub}
            </span>
          </div>
          {body()}
        </div>

        {step !== 'done' && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ alignSelf: 'center', fontSize: 11 }}
            onClick={() => finish(true)}
          >
            Skip setup — I will do this later
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
      {label}
      {children}
    </label>
  );
}

function Actions({
  primary,
  onPrimary,
  onSkip,
  disabled,
  busy,
  error,
}: {
  primary: string;
  onPrimary: () => void;
  onSkip?: () => void;
  disabled?: boolean;
  busy?: boolean;
  error?: unknown;
}) {
  return (
    <>
      {error !== null && error !== undefined && (
        <span className="field-error">{(error as Error).message}</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
        <button type="button" className="btn btn-pink" disabled={disabled} onClick={onPrimary}>
          {busy ? 'Saving…' : primary}
          {!busy && <Icon name="chevron" size={13} />}
        </button>
        {onSkip && (
          <button type="button" className="btn btn-ghost" onClick={onSkip}>
            Skip this
          </button>
        )}
      </div>
    </>
  );
}
