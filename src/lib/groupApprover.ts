import type { Group } from "@/lib/data-access/types";

/**
 * Who answers a group's join requests: its creator while they're still a
 * member, otherwise the first current member (a group created before the
 * creator was recorded, or whose creator was removed by an admin). Pure, so
 * the data store and GroupPanel agree on the same answer.
 */
export function getGroupApproverId(group: Pick<Group, "memberIds" | "creatorGuestId">): string | null {
  if (group.creatorGuestId && group.memberIds.includes(group.creatorGuestId)) return group.creatorGuestId;
  return group.memberIds[0] ?? null;
}
