export type MilestoneKind = 'favorites' | 'views';
export type BookMilestone = {kind: MilestoneKind; threshold: number; achievedAt: string | null};
export const milestoneThresholds: Readonly<Record<MilestoneKind, readonly number[]>>;
export function milestoneNumber(value: number): string;
export function reachedMilestones(counts: Partial<Record<MilestoneKind, number>>, achievedAt?: string | null): BookMilestone[];
