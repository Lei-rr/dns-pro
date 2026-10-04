#!/usr/bin/env node
import assert from 'node:assert/strict'
import { useJobProgress } from '../web/src/shared/job/model/use-job-progress.js'

// 行为断言：恢复活跃任务失败时必须与"无活跃任务"可区分
const progress = useJobProgress()
const resumeResult = await progress.resumeActive(
  async () => {
    throw new Error('active job unavailable')
  },
  { fetchJob: async () => ({ id: 'unused', status: 'completed' }), autoClearMs: 0 }
)
assert.equal(resumeResult, null)
assert.equal(progress.running.value, false)
assert.equal(
  progress.resumeError.value,
  'active job unavailable',
  'resume failure is indistinguishable from no active job'
)

console.log('frontend-audit-probe=ok job-resume=failure-distinguishable')
