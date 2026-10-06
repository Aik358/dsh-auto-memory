// ★批次 W（2026-10-05，PR#210 拆取）：锁物理合一。
//  历史上本文件持有 calendar-lock 的完整实现；PR#210 又复制出一份逐行相同的
//  shared-state-lock.js（issue #207 接续状态跨进程锁）——违反「不另起第三套锁」纪律。
//  现把共享锁实现统一收敛到 lib/shared-state-lock.js（保留 PR 文件名，含符号链接拒绝守卫），
//  本文件改为薄壳 re-export：公开 API（canonicalCalendarPath / withCalendarLock）与
//  默认 10s 限时、死主恢复、双文件 gate 语义全部不变，仅供既有调用点/测试按旧名引用。
export { canonicalSharedStatePath as canonicalCalendarPath, withSharedStateLock as withCalendarLock } from './shared-state-lock.js'
