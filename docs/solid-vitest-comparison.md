# Solid component test runner comparison

Measured on 2026-11-27 at baseline `2553848` using Node 24.20.0, Vite 6.4.4,
Solid 1.9.17 and happy-dom 21.0.4. Each test invocation was restricted to a
1 GiB systemd scope with swap disabled and a 512 MiB Node old-space limit.
These are three sequential runs on a shared machine, not controlled benchmarks.

| Test file | Existing Node/Vite-build harness | Vitest 5.1.2 |
| --- | --- | --- |
| UI DOM, 17 cases | 1.03 s; 297 MiB sampled process-tree RSS | 0.75 s; 306 MiB sampled process-tree RSS |
| Workspace ticket viewer, 20 cases | 1.61 s; 313 MiB sampled process-tree RSS | 1.22 s; 337 MiB sampled process-tree RSS |

Individual measurements used `npm run test:memory` and shell wall time. RSS is
sampled, can miss peaks, and sums shared memory across processes. Timings include
the npm and measurement runners. The table reports medians of three runs. Both files passed with their original case
counts. The old harness built a separate Vite library bundle for each file; the
Vitest tests import components directly.

Vitest can also run both files together: one scoped invocation passed all 37
cases in a median 1.40 s wall time with a median 190 MiB cgroup `memory.peak`. This invocation
ran Vitest directly inside the same 1 GiB scope, without the npm measurement
runner, so the wall time is not an exact apples-to-apples comparison with the
individual runs. Cgroup memory and summed process RSS are different measurements
and cannot be compared as if equivalent. No before-run cgroup peak was captured.
The three individual UI timings were 1.072, 1.034 and 0.954 s before and 0.761,
0.732 and 0.747 s after; sampled RSS ranged 283–316 MiB before and 304–313 MiB
after. The ticket timings were 1.629, 1.580 and 1.608 s before and 1.681, 1.203
and 1.219 s after; sampled RSS ranged 301–326 MiB before and 336–380 MiB after.
The shared-run wall times were 1.458, 1.401 and 1.396 s; cgroup peaks ranged
187–200 MiB.
The 11 migrated files without the known navigation failure passed 85 cases in
6.92 s with a 260 MiB cgroup peak in one additional scoped run. No equivalent
before measurement was captured for that group.

The baseline `2553848` had a failing `navigation-dom` expectation, which the
migration retained. After merging `main` at `76f5bec`, the same navigation test,
two additional navigation picker tests, one UI dialog assertion, and the
application composition test also fail under the original Node harness on
`main`; their migrated counterparts retain those failures. Their expected
behavior was not changed as part of this comparison.
The existing `command-contract.test.js` also fails on `main` at `76f5bec`
because its source-pattern expectation no longer matches Workspace navigation.
The migration uses happy-dom, not the Solid guide's default jsdom, to preserve
existing DOM and dialog behavior while changing the runner. Browser and native
integration remain separate opt-in cohorts.
