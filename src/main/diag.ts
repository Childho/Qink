import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/* ---------- 现场诊断日志（ADR-0009 同期引入） ----------
 * 起因：装机用户反馈「图标没过一会就消失不见了」，而现场零日志——
 * 窗口隐藏/渲染层崩溃/睡眠唤醒/显示器变化哪条路走的，事后完全无从判断。
 * 设计约束：
 * - 极低频事件才记（boot/quit/崩溃/自愈/电源/显示器/形态切换/窗口隐藏），不记热路径；
 * - 双写：stdout（dev 终端可见）+ userData/qink.log（装机用户可回传）；
 * - 永不抛错：日志失败不能影响主流程（静默吞，console 兜底可见）。
 */

const MAX_LOG_BYTES = 512 * 1024

let rotated = false // 启动时轮转一次，运行期内超限不再轮转（低频事件写不满半兆）

function logFile(): string {
  return join(app.getPath('userData'), 'qink.log')
}

export function logDir(): string {
  return app.getPath('userData')
}

function fmt(detail: unknown): string {
  if (detail === undefined) return ''
  if (typeof detail === 'object') {
    try {
      return JSON.stringify(detail)
    } catch {
      return String(detail)
    }
  }
  return String(detail)
}

/** 追加一行诊断日志。fire-and-forget：调用方永远不等它。 */
export function diag(event: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} [${event}]${fmt(detail) ? ' ' + fmt(detail) : ''}`
  console.log(`[qink-diag] ${line}`)
  void (async () => {
    try {
      const file = logFile()
      if (!rotated) {
        rotated = true
        const size = (await stat(file).catch(() => null))?.size ?? 0
        if (size > MAX_LOG_BYTES) await rename(file, `${file}.old`).catch(() => {})
      }
      await mkdir(app.getPath('userData'), { recursive: true })
      await appendFile(file, line + '\n', 'utf-8')
    } catch {
      // 落盘失败只剩 console，可接受：dev/现场终端仍能看到
    }
  })()
}
