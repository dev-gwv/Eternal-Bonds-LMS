import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreatePost, type Post } from '@ipc/contracts';
import { api, relativeTime, xpLabel } from '../shared/api.ts';
import { PageHeader, Page } from '../shared/layout/AppShell.tsx';
import { Avatar, Card, Chip, Icon, Tile } from '../shared/ui/primitives.tsx';
import { CommentThread } from '../shared/ui/Comments.tsx';

const CHANNEL_ICON: Record<string, { icon: string; tone: 'pink' | 'yellow' | 'blue' | 'green' }> = {
  wins: { icon: 'heart', tone: 'pink' },
  announcements: { icon: 'megaphone', tone: 'yellow' },
  'ask-for-help': { icon: 'comment', tone: 'blue' },
  introductions: { icon: 'plus', tone: 'green' },
};

function PostCard({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  // The thread is collapsed until asked for: a feed of twenty posts must not
  // be twenty comment queries nobody wanted.
  const [showComments, setShowComments] = useState(false);

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
    <article className="card" style={{ padding: '14px 16px' }}>
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
        <button type="button" className="btn btn-ghost" aria-label="Post options">
          <Icon name="chevron" size={15} />
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: '#4a4a57' }}>{post.bodyMd}</p>

      {post.mediaCount > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: Math.min(post.mediaCount, 3) }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 116,
                borderRadius: 11,
                background:
                  i % 2 === 0
                    ? 'linear-gradient(135deg, #fdecf5 0%, #f9d6e6 100%)'
                    : 'linear-gradient(135deg, #fef3c7 0%, #fbe5a0 100%)',
              }}
            />
          ))}
        </div>
      )}

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
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost">
          <Icon name="share" size={14} strokeWidth={1.9} />
          Share
        </button>
      </div>

      {showComments && <CommentThread postId={post.id} />}
    </article>
  );
}

export function CommunityPage() {
  const [channel, setChannel] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const queryClient = useQueryClient();

  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels });
  const posts = useQuery({ queryKey: ['posts', channel ?? 'all'], queryFn: () => api.posts(channel) });
  const leaderboard = useQuery({ queryKey: ['leaderboard'], queryFn: api.leaderboard });

  const createPost = useMutation({
    mutationFn: api.createPost,
    onSuccess: () => {
      setDraft('');
      // Refetch rather than patch the cache: the server owns ordering and counts.
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  return (
    <Page>
      <PageHeader
        title="Community"
        crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Feed' }]}
        actions={
          <button type="button" className="btn btn-pink" style={{ padding: '10px 18px' }}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            Create
          </button>
        }
      />

      <div className="content">
        <div className="col" style={{ width: 226, flexShrink: 0 }}>
          <div className="card" style={{ padding: 12, gap: 3 }}>
            <button
              type="button"
              className="nav-pill"
              style={channel === undefined ? { background: 'var(--pink-tint)', color: 'var(--pink-ink)', border: 0 } : { border: 0, background: 'transparent' }}
              onClick={() => setChannel(undefined)}
            >
              <Icon name="dashboard" size={15} strokeWidth={1.9} />
              Feed
            </button>
            <button type="button" className="nav-pill" style={{ border: 0, background: 'transparent' }}>
              <Icon name="comment" size={15} />
              <span style={{ flex: 1, textAlign: 'left' }}>Messages</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', background: 'var(--red)', borderRadius: 999, padding: '2px 6px' }}>24</span>
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
                  onClick={() => setChannel(ch.slug)}
                >
                  <Tile size={22} tone={meta.tone}><Icon name={meta.icon} size={11} strokeWidth={2.2} /></Tile>
                  <span style={{ flex: 1, textAlign: 'left' }}>{ch.name}</span>
                  {ch.unread > 0 && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--pink)' }} />}
                </button>
              );
            })}
          </div>

          <div className="promo">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow-deep)' }}>Post your first win</span>
            <span style={{ fontSize: 10, lineHeight: 1.5, color: '#7a5a00' }}>
              Members who post a win in week one stay twice as long.
            </span>
            <button type="button" className="btn" style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--yellow-deep)', fontSize: 10 }}>
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
              <Avatar initials="AK" size={34} />
              <label htmlFor="composer" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Share a post
              </label>
              <input
                id="composer"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Share a win, a question, or what you shot today…`}
                style={{ flex: 1, fontSize: 12, color: 'var(--ink)', background: 'transparent', border: 0, outline: 'none' }}
              />
              <button type="button" className="icon-btn btn-sq" aria-label="Add photo">
                <Icon name="image" size={15} strokeWidth={1.9} />
              </button>
              <button
                type="submit"
                className="btn btn-pink"
                disabled={draft.trim().length < 4 || createPost.isPending}
              >
                {createPost.isPending ? 'Posting…' : 'Post'}
              </button>
            </div>
            {createPost.isError && (
              <span style={{ fontSize: 11, color: 'var(--red)' }}>{createPost.error.message}</span>
            )}
          </form>

          {posts.isPending && <p className="muted" style={{ fontSize: 12 }}>Loading the feed…</p>}
          {(posts.data ?? []).map((p) => <PostCard key={p.id} post={p} />)}
        </div>

        <div className="col rail">
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="card-title" style={{ flex: 1 }}>Next up</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, color: 'var(--green-ink)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--green-ink)' }} />
                Live in 14m
              </span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}>New Diamond Members Planning Call</span>
            <span style={{ fontSize: 10 }} className="dim">Sat 20 Sep · 9:00 AM – 2:00 PM</span>
            <button type="button" className="btn btn-blue btn-sq" style={{ padding: 9 }}>Join the call</button>
          </Card>

          <Card title="Leaderboard" action={<a href="#leaderboard" style={{ fontSize: 10 }}>View all</a>} style={{ flex: 1 }}>
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
            <div style={{ marginTop: 'auto', background: 'var(--soft)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>You · rank 34</span>
              <span style={{ fontSize: 10 }} className="dim">3.1K XP to the top 25</span>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
