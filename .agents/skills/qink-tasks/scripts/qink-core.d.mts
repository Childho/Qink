// qink-core.mjs 的最小类型声明（typecheck 导入用；语义以运行时奇偶校验测试为准）
export type SkillPeriodKind = 'quarter' | 'month' | 'week'
export interface SkillTask {
  id: string
  text: string
  createdAt: string
  pinned?: boolean
  dueAt?: string
}
export interface SkillQinkData {
  version?: number
  goals: Record<string, unknown>
  tasks: SkillTask[]
  archive: unknown[]
  settings: Record<string, unknown>
}
export type SkillDueParse = { ok: true; dueAt: string } | { ok: false }
export type SkillDueStatus = 'future' | 'tomorrow' | 'urgent' | 'overdue'

export function dateKey(d: Date): string
export function quarterKey(d: Date): string
export function monthKey(d: Date): string
export function weekKey(d: Date): string
export function periodKeyFor(kind: SkillPeriodKind, d: Date): string
export function daysSince(createdAtISO: string, now: Date): number
export function isRolledIn(createdAtISO: string, now: Date): boolean
export function parseDueInput(raw: string, now: Date): SkillDueParse
export function dueStatus(dueAt: string, now: Date): SkillDueStatus
export function emptyData(): SkillQinkData
export function validateQinkData(d: unknown): { ok: true } | { ok: false; reason: string }
export function applyOps(
  data: unknown,
  ops: Record<string, unknown>,
  now: Date
): { ok: false; reason: string } | { ok: true; data: SkillQinkData; report: Record<string, unknown> & { added: { id: string; text: string; dueAt: string | null }[]; skippedDuplicate: string[]; completed: { id: string; text: string }[]; deleted: { id: string; text: string }[]; notFound: string[]; goal: { kind: string; from: { periodKey: string; text: string } | null; set: { periodKey: string; text: string } | null } | null; replaced: { oldCount: number; tasks: SkillTask[] } | null } }
export function verifyApplied(data: unknown, report: Record<string, unknown>): boolean
