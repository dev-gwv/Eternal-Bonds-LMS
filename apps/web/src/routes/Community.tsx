import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { CreatePost, type Post } from '@ipc/contracts';
import { api, relativeTime, xpLabel } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, EmptyState, Icon, Tile } from '../shared/ui/primitives.tsx';
import { CommentThread } from '../shared/ui/Comments.tsx';
import { Gallery } from '../shared/ui/Gallery.tsx';
import { PickerButton, PickerStrip, usePicker } from '../shared/ui/ImagePicker.tsx';
import { uploadAll } from '../shared/media.ts';
import { NextUp } from '../shared/ui/NextUp.tsx';
import { ReportButton } from '../shared/ui/ReportButton.tsx';
import { useSeen } from '../shared/ui/useSeen.tsx';
import { LoadingLabel, SkeletonCard } from '../shared/ui/Skeleton.tsx';
import { StaggerItem, StaggerList } from '../shared/ui/motion.tsx';
import { useToast } from '../shared/ui/Toast.tsx';

const CHANNEL_ICON: Record<string, { icon: string; tone: 'pink' | 'yellow' | 'blue' | 'green' }> = {
  wins: { icon: 'heart', tone: 'pink' },
  announcements: { icon: 'megaphone', tone: 'yellow' },
  'ask-for-help': { icon: 'comment', tone: 'blue' },
  introductions: { icon: 'plus', tone: 'green' },
};

function PostCard({ post, seenRef }: { post: Post; seenRef?: (node: HTMLElement | null) => void }) {
  const queryClient = useQueryClient();
  // The thread is collapsed until asked for: a feed of twenty posts must not
  // be twenty comment queries nobody wanted.
  const [showComments, setShowComments] = useState(false);
  const [shared, setShared] = useState(false);

  const like = useMutation({
    mutationFn: (liked: boolean) => api.likePost(post.id, liked),
    // Optimistic, because a heart that waits for a round trip feels broken.
    onMutate: async (liked) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      const previous = queryClient.getQueriesData<Post[]>({ queryKey: ['posts'] });
      for (const [key, posts] of previous) {
        if (!posts) continue;
        queryClient.setQueryData<Post[]>(
          key,
          posts.map((p) =>
            p.id === post.id ? { ...p, likedByMe: liked, likes: Math.max(0, p.likes + (liked ? 1 : -1)) } : p,
          ),
        );
      }
      return { previous };
    },
    // Put it back if the server disagreed, rather than leaving a lie on screen.
    onError: (_error, _liked, context) => {
      for (const [key, posts] of context?.previous ?? []) queryClient.setQueryData(key, posts);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['posts'] }),
  });

  return (
    <article className="card lift" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar initials={post.author.initials} size={36} tone={post.channelSlug === 'wins' ? 'pink' : 'blue'} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{post.author.name}</span>
            <Chip tone="pink">{post.author.tier === 'diamond' ? 'Diamond' : post.author.tier}</Chip>
          </div>
          <span style={{ fontSize: 10 }} className="dim">
            {relativeTime(post.createdAt)} · {post.channelSlug.replace(/-/g, ' ')}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: '#4a4a57' }}>{post.bodyMd}</p>

      {/* Was a row of pink gradient rectangles standing in for photographs
          that the app could not upload. Both halves are real now. */}
      {post.media.length > 0 && <Gallery media={post.media} />}

      {post.teamReply && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--yellow-soft)', borderRadius: 10, padding: '10px 12px' }}>
          <span className="avatar" style={{ width: 24, height: 24, fontSize: 9, background: 'var(--yellow)', color: 'var(--yellow-deep)' }}>
            IPC
          </span>
          <span style={{ fontSize: 11, color: '#8a6a0e', flex: 1 }}>
            <strong style={{ color: 'var(--yellow-deep)' }}>Team replied</strong> — {post.teamReply}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 9, borderTop: '1px solid var(--softer)' }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-pressed={post.likedByMe}
          style={{ color: post.likedByMe ? 'var(--pink-ink)' : 'var(--ink-2)' }}
          onClick={() => like.mutate(!post.likedByMe)}
        >
          <Icon name="heart" size={15} strokeWidth={post.likedByMe ? 2.6 : 1.9} />
          {post.likes}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={showComments}
          style={{ color: showComments ? 'var(--ink)' : 'var(--ink-2)' }}
          onClick={() => setShowComments((open) => !open)}
        >
          <Icon name="comment" size={15} strokeWidth={1.9} />
          {post.comments}
        </button>
        {post.views > 0 && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}
            className="dim"
            title={`${post.views} member${post.views === 1 ? '' : 's'} have seen this`}
          >
            <Icon name="eye" size={14} strokeWidth={1.9} />
            {post.views > 999 ? `${(post.views / 1000).toFixed(1)}K` : post.views}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            const url = `${window.location.origin}/community?post=${post.id}`;
            try {
              // navigator.share is the right thing on a phone and does not
              // exist on most desktops; the clipboard is the fallback.
              if (navigator.share) await navigator.share({ text: post.bodyMd.slice(0, 120), url });
              else {
                await navigator.clipboard.writeText(url);
                setShared(true);
                setTimeout(() => setShared(false), 1800);
              }
            } catch {
              /* The member dismissed the share sheet. Not an error. */
            }
          }}
        >
          <Icon name={shared ? 'check' : 'share'} size={14} strokeWidth={1.9} />
          {shared ? 'Link copied' : 'Share'}
        </button>
        {/* Quiet on purpose: a prominent flag on every post becomes a disagree
            button. Small and grey is enough for the person who needs it. */}
        <ReportButton targetType="post" targetId={post.id} />
      </div>

      {showComments && <CommentThread postId={post.id} />}
    </article>
  );
}

export function CommunityPage() {
  const composer = useRef<HTMLInputElement>(null);
  const focusComposer = () => {
    composer.current?.focus();
    composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const [channel, setChannel] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, retry: false });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  const queryClient = useQueryClient();

  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels });

  // Opening a channel is what marks it read — a separate button would be one
  // more click for something the member has already done. Fired on selection
  // rather than on render so simply loading the page does not silently clear
  // every badge.
  const markRead = useMutation({
    mutationFn: (slug: string) => api.markChannelRead(slug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });

  const seen = useSeen();
  const totalUnread = (channels.data ?? []).reduce((n, ch) => n + ch.unread, 0);

  const openChannel = (slug: string | undefined) => {
    setChannel(slug);
    if (slug) markRead.mutate(slug);
  };

  const posts = useQuery({ queryKey: ['posts', channel ?? 'all'], queryFn: () => api.posts(channel) });
  const leaderboard = useQuery({ queryKey: ['leaderboard'], queryFn: api.leaderboard });

  const picker = usePicker();
  const toast = useToast();

  // Post first, then photographs. A media ticket is scoped to a post id, so
  // the row has to exist before anything can be uploaded against it — and it
  // means a failed upload costs the photos, never the words.
  const createPost = useMutation({
    mutationFn: async (input: CreatePost) => {
      const post = await api.createPost(input);
      if (picker.items.length > 0) {
        await uploadAll({ kind: 'post', id: post.id }, picker.items, picker.patch);
      }
      return post;
    },
    onSuccess: () => {
      setDraft('');
      picker.reset();
      toast.show('Posted');
      // Refetch rather than patch the cache: the server owns ordering and counts.
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: toast.error,
  });

  return (
    <Page>
      <PageHeader
        title="Community"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Feed' }]}
        actions={
          <button type="button" className="btn btn-pink" style={{ padding: '10px 18px' }} onClick={focusComposer}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            Write a post
          </button>
        }
      />

      <div className="content">
        <div className="col side-column" style={{ width: 226, flexShrink: 0 }}>
          <div className="card" style={{ padding: 12, gap: 3 }}>
            <button
              type="button"
              className="nav-pill"
              style={channel === undefined ? { background: 'var(--pink-tint)', color: 'var(--pink-ink)', border: 0 } : { border: 0, background: 'transparent' }}
              onClick={() => openChannel(undefined)}
            >
              <Icon name="dashboard" size={15} strokeWidth={1.9} />
              <span style={{ flex: 1, textAlign: 'left' }}>Feed</span>
              {totalUnread > 0 && (
                <span
                  aria-label={`${totalUnread} unread in total`}
                  style={{
                    fontSize: 9, fontWeight: 600, color: '#fff', background: 'var(--pink)',
                    borderRadius: 999, padding: '2px 6px', minWidth: 16, textAlign: 'center',
                  }}
                >
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </button>
          </div>

          <div className="card" style={{ padding: 12, gap: 4, flex: 1 }}>
            <span className="section-label" style={{ padding: '2px 4px 6px' }}>Channels</span>
            {(channels.data ?? []).map((ch) => {
              const meta = CHANNEL_ICON[ch.slug] ?? { icon: 'comment', tone: 'blue' as const };
              const active = channel === ch.slug;
              return (
                <button
                  key={ch.id}
                  type="button"
                  className="nav-pill"
                  style={{
                    border: 0,
                    background: active ? 'var(--pink-tint)' : 'transparent',
                    color: active ? 'var(--pink-ink)' : 'var(--ink-2)',
                    fontSize: 11,
                  }}
                  onClick={() => openChannel(ch.slug)}
                >
                  <Tile size={22} tone={meta.tone}><Icon name={meta.icon} size={11} strokeWidth={2.2} /></Tile>
                  <span style={{ flex: 1, textAlign: 'left' }}>{ch.name}</span>
                  {ch.unread > 0 && (
                    <span
                      aria-label={`${ch.unread} unread`}
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: '#fff',
                        background: 'var(--pink)',
                        borderRadius: 999,
                        padding: '2px 6px',
                        minWidth: 16,
                        textAlign: 'center',
                      }}
                    >
                      {ch.unread > 99 ? '99+' : ch.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="promo">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow-deep)' }}>Post your first win</span>
            <span style={{ fontSize: 10, lineHeight: 1.5, color: '#7a5a00' }}>
              Members who post a win in week one stay twice as long.
            </span>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--yellow-deep)', fontSize: 10 }}
              onClick={() => {
                openChannel('wins');
                focusComposer();
              }}
            >
              Share a win
            </button>
          </div>
        </div>

        <div className="col col-main">
          <form
            className="card"
            style={{ gap: 8, padding: '11px 14px' }}
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = CreatePost.safeParse({ channelSlug: channel ?? 'wins', bodyMd: draft });
              if (!parsed.success) return;
              createPost.mutate(parsed.data);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Avatar initials={me.data?.initials ?? '··'} size={34} />
              <label htmlFor="composer" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Share a post
              </label>
              <input
                id="composer"
                ref={composer}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Share a win, a question, or what you shot today…`}
                style={{ flex: 1, fontSize: 12, color: 'var(--ink)', background: 'transparent', border: 0, outline: 'none' }}
              />
              <button
                type="submit"
                className="btn btn-pink"
                disabled={draft.trim().length < 4 || createPost.isPending}
              >
                {createPost.isPending
                  ? picker.items.length > 0
                    ? 'Uploading…'
                    : 'Posting…'
                  : 'Post'}
              </button>
            </div>

            <PickerStrip items={picker.items} onRemove={picker.remove} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 45 }}>
              <PickerButton onPick={picker.add} count={picker.items.length} disabled={createPost.isPending} />
              <span style={{ fontSize: 10 }} className="dim">
                {picker.items.length > 0 && draft.trim().length < 4
                  ? 'Add a line about the shot — a photo with no words gets no replies.'
                  : 'Photos are resized and their location data removed before upload.'}
              </span>
            </div>

          </form>

          {posts.isPending && (
            <>
              <LoadingLabel>Loading the feed</LoadingLabel>
              <SkeletonCard lines={3} />
              <SkeletonCard lines={2} />
            </>
          )}

          {posts.isError && (
            <div className="alert">{(posts.error as Error).message}</div>
          )}

          {!posts.isPending && (posts.data ?? []).length === 0 && (
            <Card>
              <EmptyState
                icon={channel ? 'comment' : 'community'}
                title={channel ? 'Nothing in this channel yet' : 'The feed is quiet'}
                hint={
                  channel
                    ? 'Be the first to post here — it is usually the one that starts the conversation.'
                    : 'Share what you shot this week, ask for a critique, or post a win. Everyone sees it.'
                }
              />
            </Card>
          )}

          {/* Staggered at 40ms. A feed that appears all at once reads as a
              screenshot; one that arrives over two seconds reads as slow. */}
          <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(posts.data ?? []).map((p) => (
              <StaggerItem key={p.id} layout>
                <PostCard post={p} seenRef={seen(p.id)} />
              </StaggerItem>
            ))}
          </StaggerList>
        </div>

        <div className="col rail">
          <NextUp />

          <Card title="Leaderboard" style={{ flex: 1 }}>
            {(leaderboard.data ?? []).length === 0 && !leaderboard.isPending && (
              <EmptyState
                icon="chart"
                title="No rankings yet"
                hint="XP is earned by finishing lessons, posting, and attending workshops. The board fills in as members get going."
              />
            )}
            {(leaderboard.data ?? []).slice(0, 4).map((row) => (
              <div
                key={row.rank}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 9px',
                  borderRadius: 10,
                  background: row.rank === 1 ? 'var(--pink-tint)' : 'transparent',
                }}
              >
                <span
                  className="avatar"
                  style={{
                    width: 19,
                    height: 19,
                    fontSize: 9,
                    background: row.rank === 1 ? 'var(--pink)' : 'var(--soft)',
                    color: row.rank === 1 ? '#fff' : 'var(--ink-2)',
                  }}
                >
                  {row.rank}
                </span>
                <span style={{ flex: 1, fontSize: 11 }}>{row.name}</span>
                <span className="num" style={{ fontSize: 10, color: row.rank === 1 ? 'var(--pink-strong)' : 'var(--ink-2)' }}>
                  {xpLabel(row.xp)}
                </span>
              </div>
            ))}
            {/* Was "You · rank 34 · 3.1K XP to the top 25", the same two
                numbers for every member regardless of their actual standing. */}
            {stats.data && (
              <div style={{ marginTop: 'auto', background: 'var(--soft)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 600 }}>
                  {stats.data.rank ? `You · rank ${stats.data.rank}` : 'You · unranked'}
                </span>
                <span style={{ fontSize: 10 }} className="dim">
                  {stats.data.xp > 0
                    ? `${xpLabel(stats.data.xp)} XP earned`
                    : 'Post a win or finish a lesson to get on the board'}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
