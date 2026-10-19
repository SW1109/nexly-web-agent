# Third-party notices

## OCS (ocsjs/ocsjs)

- Source: https://github.com/ocsjs/ocsjs
- Reviewed revision: `8b25a3f44523a0d4b7373878488056f4aa478cf6` (`5.0` branch).
- Adapted material: platform names, course/quiz DOM selectors and visible course-navigation identification from `packages/scripts/src/projects/{cx,zhs,icourse}.ts`.
- QuizMate provides its own MV3 task lifecycle and playback observation. No OCS executable bundle, answer-bank service, private API, verification workaround or remote script is included. MOOC Reminder was researched but its code is not incorporated.
- The copyright and license below also ship in the extension's offline notices page.

```text
MIT License

Copyright (c) 2022 enncy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Behavioral reference: alv002/meto

- Source reviewed read-only: https://github.com/alv002/meto (`update.user.js`, metadata version `5.4.10`, snapshot retrieved 2026-10-19).
- Snapshot SHA-256: `271e6f9b335999d071c119a648c8fa6eff103c9ed26bd19a5ed64d84fc9e1aa9` (6,975 lines, 339,526 bytes). This is not claimed to be identical to the user's installed `5.3.51` script.
- Considered only hostname dispatch, visible next-activity control semantics (including the `newgk-next` theme class), bounded player loading and control organization. The source metadata declares MIT, but no upstream source body or executable dependency is distributed by QuizMate.
- The upstream Open University implementation advances after a fixed delay. QuizMate does **not** reuse that behavior: it requires the normal player to end and a unique safe destination, then waits for new-document/media readiness. No focus spoofing, random verification answers, account extraction, private completion APIs, remote answer bank or remote script loading was incorporated.
