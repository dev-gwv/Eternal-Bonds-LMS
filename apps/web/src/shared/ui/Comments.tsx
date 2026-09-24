import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Comment } from '@ipc/contracts';
import { api, relativeTime } from '../api.ts';
import { ConfirmButton } from './ConfirmButton.tsx';
import { Avatar, Chip, Icon } from './primitives.tsx';

/**
 * A comment thread, nested one level.
 *
 * One level is a decision, not a limitation: deeper threads are unreadable on
 * a phone, and a reply to a reply attaches to the same root, so the shape
 * cannot drift even if someone crafts the request by hand.
 */

function Composer({
  postId,
  parentId,
  placeholder,
  autoFocus,
  onDone,
}: {
  postId: string;
  parentId: string | null;
  placeholder: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: () => api.addComment(postId, { bodyMd: body.trim(), parentId }),
    onSuccess: () => {
      setBody('');
      // Both: the thread gains a row and the post's counter changes with it.
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      onDone?.();
    },
  });

  const valid = body.trim().length > 0;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <textarea
        value={body}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. A comment box that needs
          // a mouse click to send is a comment box people abandon.
          if (e.key === 'Enter' && !e.shiftKey && valid) {
            e.preventDefault();
            add.mutate();
          }
        }}
        style={{
          flex: 1,
          font: 'inherit',
          fontSize: 12,
          lineHeight: 1.55,
          background: 'var(--soft)',
          border: '1px solid transparent',
          borderRadius: 'var(--r-ctl)',
          padding: '9px 11px',
          color: 'var(--ink)',
          resize: 'vertical',
          minHeight: 36,
        }}
      />
      <button type="button" className="btn btn-pink" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
        {add.isPending ? 'Posting…' : 'Reply'}
      </button>
      {onDone && (
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      )}
      {add.error && <span className="field-error">{(add.error as Error).message}</span>}
    </div>
  );
}

function CommentRow({ comment, postId, depth }: { comment: Comment; postId: string; depth: number }) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.bodyMd);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', postId] });
    queryClient.invalidateQueries({ queryKey: ['posts'] });
  };

  const like = useMutation({
    mutationFn: (liked: boolean) => api.likeComment(comment.id, liked),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
  });
  const save = useMutation({
    mutationFn: () => api.editComment(comment.id, draft.trim()),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteComment(comment.id), onSuccess: refresh });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: depth * 34 }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <Avatar initials={comment.author.initials} size={26} tone={depth === 0 ? 'blue' : 'grey'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{comment.author.name}</span>
            {comment.author.tier !== 'free' && <Chip tone="pink">{comment.author.tier}</Chip>}
            <span style={{ fontSize: 10 }} className="dim">
              {relativeTime(comment.createdAt)}
              {comment.editedAt && ' · edited'}
            </span>
          </div>

          {editing ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
              <textarea
                value={draft}
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                style={{
                  flex: 1,
                  font: 'inherit',
                  fontSize: 12,
                  background: 'var(--soft)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--r-ctl)',
                  padding: '8px 10px',
                  color: 'var(--ink)',
                }}
              />
              <button type="button" className="btn btn-pink" disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <p
              style={{
                margin: '3px 0 0',
                fontSize: 12,
                lineHeight: 1.6,
                color: comment.deleted ? 'var(--ink-3)' : 'var(--ink-2)',
                fontStyle: comment.deleted ? 'italic' : 'normal',
              }}
            >
              {comment.bodyMd}
            </p>
          )}

          {!comment.deleted && !editing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: comment.likedByMe ? 'var(--pink-ink)' : 'var(--ink-3)', fontSize: 10 }}
                onClick={() => like.mutate(!comment.likedByMe)}
              >
                <Icon name="heart" size={13} strokeWidth={comment.likedByMe ? 2.4 : 1.8} />
                {comment.likes > 0 ? comment.likes : 'Like'}
              </button>
              {/* Only root comments offer Reply — the reply box on a reply
                  would suggest a depth the thread does not have. */}
              {depth === 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 10 }}
                  onClick={() => setReplying((r) => !r)}
                >
                  Reply
                </button>
              )}
              {comment.mine && (
                <>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 10 }} onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  {/* Two presses. A comment is somebody's own words and the
                      Delete that removes them sat one pixel from Edit. */}
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete it"
                    style={{ fontSize: 10, color: 'var(--red)' }}
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate()}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {replying && (
        <div style={{ marginLeft: 35 }}>
          <Composer
            postId={postId}
            parentId={comment.id}
            placeholder={`Reply to ${comment.author.name.split(' ')[0]}…`}
            autoFocus
            onDone={() => setReplying(false)}
          />
        </div>
      )}

      {comment.replies.map((reply) => (
        <CommentRow key={reply.id} comment={reply} postId={postId} depth={depth + 1} />
      ))}
    </div>
  );
}

export function CommentThread({ postId }: { postId: string }) {
  // Only fetched once the thread is opened: a feed of twenty posts should not
  // be twenty comment queries nobody asked for.
  const comments = useQuery({ queryKey: ['comments', postId], queryFn: () => api.comments(postId) });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        paddingTop: 11,
        borderTop: '1px solid var(--softer)',
      }}
    >
      {comments.isLoading && <span style={{ fontSize: 11 }} className="dim">Loading the thread…</span>}
      {comments.error && <span className="field-error">{(comments.error as Error).message}</span>}

      {comments.data?.map((comment) => (
        <CommentRow key={comment.id} comment={comment} postId={postId} depth={0} />
      ))}

      {comments.data?.length === 0 && (
        <span style={{ fontSize: 11 }} className="dim">
          No comments yet. Be the first.
        </span>
      )}

      <Composer postId={postId} parentId={null} placeholder="Add a comment…" />
    </div>
  );
}
