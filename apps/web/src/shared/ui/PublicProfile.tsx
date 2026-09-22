import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Card, Chip } from './primitives.tsx';
import { useToast } from './Toast.tsx';

/**
 * The part of your profile other members see.
 *
 * `PUT /v1/learning/me` has existed with no caller, which meant a member could
 * not write a bio, could not say what they shoot, and could not choose whether
 * to appear in the directory — while the Account page showed them their own
 * details with nothing editable on it. The directory was therefore a list of
 * people who had all defaulted to the same blank entry.
 *
 * Expertise is comma-separated rather than a tag widget: eight tags, entered
 * once, does not justify the interface a tag widget needs.
 */
export function PublicProfileCard() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['my-profile'], queryFn: api.myProfile, retry: false });

  const [bio, setBio] = useState('');
  const [expertise, setExpertise] = useState('');
  const [listed, setListed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!profile.data) return;
    setBio(profile.data.bioMd ?? '');
    setExpertise(profile.data.expertise.join(', '));
    setListed(profile.data.showInDirectory);
  }, [profile.data]);

  const tags = expertise
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);

  const save = useMutation({
    mutationFn: () =>
      api.saveMyProfile({ bioMd: bio.trim() || null, expertise: tags, showInDirectory: listed }),
    onSuccess: () => {
      toast.show('Profile saved');
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      queryClient.invalidateQueries({ queryKey: ['directory'] });
      // The onboarding checklist reads profile completeness.
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: toast.error,
  });

  const dirty =
    profile.data !== undefined &&
    (bio.trim() !== (profile.data.bioMd ?? '') ||
      tags.join(',') !== profile.data.expertise.join(',') ||
      listed !== profile.data.showInDirectory);

  return (
    <Card title="Your public profile">
      <span style={{ fontSize: 11.5, lineHeight: 1.6 }} className="muted">
        What other members see when they find you in the directory or open one of your posts.
      </span>

      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
        About you
        <textarea
          className="input"
          rows={3}
          value={bio}
          placeholder="Wedding and portrait work out of Jaipur. Six years in, mostly destination weddings."
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
        What you shoot, separated by commas
        <input
          className="input"
          value={expertise}
          placeholder="weddings, portraits, lighting"
          onChange={(e) => setExpertise(e.target.value)}
        />
      </label>

      {tags.length > 0 && (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </span>
      )}

      <label style={{ fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <input
          type="checkbox"
          checked={listed}
          onChange={(e) => setListed(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          Show me in the member directory
          <span style={{ display: 'block', fontSize: 10.5 }} className="dim">
            Off by default. Other members can find you by city or by what you shoot.
          </span>
        </span>
      </label>

      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="btn btn-pink"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </span>
    </Card>
  );
}
