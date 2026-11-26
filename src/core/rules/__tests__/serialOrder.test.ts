import { computeSerialReorderPlan } from '../serialOrder';

describe('computeSerialReorderPlan', () => {
  const sample = [
    { id: 'm1', member_no: 1 },
    { id: 'm2', member_no: 2 },
    { id: 'm3', member_no: 3 },
    { id: 'm4', member_no: 4 },
    { id: 'm5', member_no: 5 },
  ];

  it('returns empty plan when target serial is unused', () => {
    expect(computeSerialReorderPlan(sample, 'm5', 10)).toEqual([]);
    expect(computeSerialReorderPlan(sample, null, 6)).toEqual([]);
  });

  it('shifts intermediate members +1 when moving an existing member UP', () => {
    const plan = computeSerialReorderPlan(sample, 'm5', 2);
    expect(plan).toEqual([
      { id: 'm4', previousMemberNo: 4, nextMemberNo: 5 },
      { id: 'm3', previousMemberNo: 3, nextMemberNo: 4 },
      { id: 'm2', previousMemberNo: 2, nextMemberNo: 3 },
    ]);
  });

  it('shifts intermediate members -1 when moving an existing member DOWN', () => {
    const plan = computeSerialReorderPlan(sample, 'm2', 4);
    expect(plan).toEqual([
      { id: 'm3', previousMemberNo: 3, nextMemberNo: 2 },
      { id: 'm4', previousMemberNo: 4, nextMemberNo: 3 },
    ]);
  });

  it('shifts all members >= target by +1 when inserting a new member into an occupied slot', () => {
    const plan = computeSerialReorderPlan(sample, null, 3);
    expect(plan).toEqual([
      { id: 'm5', previousMemberNo: 5, nextMemberNo: 6 },
      { id: 'm4', previousMemberNo: 4, nextMemberNo: 5 },
      { id: 'm3', previousMemberNo: 3, nextMemberNo: 4 },
    ]);
  });
});
