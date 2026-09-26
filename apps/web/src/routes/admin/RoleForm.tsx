import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminMemberDetail } from '@ipc/contracts';
import { adminApi } from '../../shared/admin-api.ts';
import { useToast } from '../../shared/ui/Toast.tsx';
import { Card, Chip } from '../../shared/ui/primitives.tsx';
import { ErrorNote, Field, Select, Toolbar } from './studio-ui.tsx';

/**
 * Making somebody an admin, and taking it back.
 *
 * This could only be done from a SQL console before, which meant the club
 * either waited for a developer or somebody kept production credentials on
 * their laptop. Neither is a reasonable answer to "make my co-founder an
 * admin", and the suspend button already told you to "demote this admin first"
 * for a control that did not exist.
 *
 * A reason is required, the same as a suspension. The audit log is the only
 * record of why somebody holds the keys, and "who gave this person admin, and
 * when" is a question that gets asked once, urgently, usually at the worst
 * possible moment.
 *
 * The real guards are server-side — you cannot change your own role, and you
 * cannot remove the last admin. This form states them before you press
 * anything rather than letting you discover them from an error.
 */

const ROLES = [
  { value: 'member', label: 'Member — the default' },
  { value: 'instructor', label: 'Instructor — appears as a teacher' },
  { value: 'admin', label: 'Admin — full access to the studio' },
] as const;

export function RoleForm({ member, onDone }: { member: AdminMemberDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState<string>(member.role);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () =>
      adminApi.setRole(member.id, { role: role as 'member' | 'instructor' | 'admin', reason: reason.trim() }),
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'member', member.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      toast.show(`${next.fullName} is now ${next.role === 'admin' ? 'an admin' : `a ${next.role}`}`);
      onDone();
    },
    onError: toast.error,
  });

  const changed = role !== member.role;
  const valid = changed && reason.trim().length >= 3;
  const promoting = role === 'admin' && member.role !== 'admin';

  return (
    <Card title={`Role for ${member.fullName}`}>
      <ErrorNote error={save.error} />

      <div className="field-row">
        <Field label="Role">
          <Select value={role} options={ROLES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRole} />
        </Field>
        <Field label="Why — recorded in the audit log">
          <input
            value={reason}
            placeholder="Co-founder, runs the Think Tank sessions"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>

      {/* Said before the button is pressed, not discovered from a 409. */}
      {promoting && (
        <div className="callout">
          <strong>An admin can do everything you can.</strong> Publish and delete courses, read every member&apos;s
          details, grant tiers, see revenue, and make other people admins. There is no lesser level of it.
        </div>
      )}

      <span style={{ fontSize: 10.5, lineHeight: 1.55 }} className="dim">
        You cannot change your own role, and the last remaining admin cannot be demoted — both would lock the club
        out of its own console.
      </span>

      <Toolbar>
        <button
          type="button"
          className={promoting ? 'btn btn-danger' : 'btn btn-pink'}
          disabled={!valid || save.isPending}
          title={
            !changed ? 'Pick a different role first' : reason.trim().length < 3 ? 'A reason is required' : undefined
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : promoting ? 'Make them an admin' : 'Change role'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10 }} className="dim">
          Currently <Chip tone={member.role === 'admin' ? 'blue' : undefined}>{member.role}</Chip>
        </span>
      </Toolbar>
    </Card>
  );
}
