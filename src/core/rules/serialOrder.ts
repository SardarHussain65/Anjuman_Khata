export interface SerialMemberItem {
  id: string;
  member_no: number;
}

export interface SerialShiftUpdate {
  id: string;
  previousMemberNo: number;
  nextMemberNo: number;
}

/**
 * Computes the minimal list of other members whose `member_no` must shift
 * so that placing `targetMemberId` (or a brand-new member when `targetMemberId`
 * is null) at `targetMemberNo` preserves unique, contiguous serial ordering.
 *
 * - If `targetMemberNo` is unused by any other member, no shifts are needed.
 * - Editing an existing member UP (`new < old`): members in `[new, old - 1]` shift `+1`.
 * - Editing an existing member DOWN (`new > old`): members in `[old + 1, new]` shift `-1`.
 * - Inserting a new member at an occupied `new`: members with `member_no >= new` shift `+1`.
 */
export function computeSerialReorderPlan(
  members: SerialMemberItem[],
  targetMemberId: string | null,
  targetMemberNo: number,
): SerialShiftUpdate[] {
  const others = members.filter((m) => m.id !== targetMemberId);
  const occupied = others.some((m) => m.member_no === targetMemberNo);
  if (!occupied) {
    return [];
  }

  const current = targetMemberId
    ? members.find((m) => m.id === targetMemberId)
    : undefined;

  if (current) {
    const oldNo = current.member_no;
    if (oldNo === targetMemberNo) return [];

    if (targetMemberNo < oldNo) {
      // Moving UP (e.g. #15 -> #10): shift #10..#14 -> #11..#15 (descending order)
      return others
        .filter((m) => m.member_no >= targetMemberNo && m.member_no < oldNo)
        .sort((a, b) => b.member_no - a.member_no)
        .map((m) => ({
          id: m.id,
          previousMemberNo: m.member_no,
          nextMemberNo: m.member_no + 1,
        }));
    }

    // Moving DOWN (e.g. #5 -> #10): shift #6..#10 -> #5..#9 (ascending order)
    return others
      .filter((m) => m.member_no > oldNo && m.member_no <= targetMemberNo)
      .sort((a, b) => a.member_no - b.member_no)
      .map((m) => ({
        id: m.id,
        previousMemberNo: m.member_no,
        nextMemberNo: m.member_no - 1,
      }));
  }

  // New member inserted at an occupied position: shift >= targetMemberNo by +1 (descending)
  return others
    .filter((m) => m.member_no >= targetMemberNo)
    .sort((a, b) => b.member_no - a.member_no)
    .map((m) => ({
      id: m.id,
      previousMemberNo: m.member_no,
      nextMemberNo: m.member_no + 1,
    }));
}
