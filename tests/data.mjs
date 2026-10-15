export const single = {
  questionId: 'practice-1', type: 'single', title: '计算', stem: '单选题：2 + 2 等于多少？',
  options: [{ id: 'option-0', label: 'A', text: '3' }, { id: 'option-1', label: 'B', text: '4' }],
  fields: [], language: '', starterCode: '', pageUrl: 'https://example.com/practice?session=private#answer'
};
export const correct = { questionId: 'practice-1', type: 'single', choiceIds: ['option-1'], fills: [], code: '', explanation: '2 + 2 = 4。', confidence: 1 };
export const codeQuestion = { ...single, questionId: 'code-9', type: 'code', title: '学生出勤记录', stem: "编程题：学生出勤记录。输入字符串只含 A、L、P。A 总数少于 2 且无连续 3 个 L 则输出 TRUE，否则 FALSE。输入 PPALLL 输出 FALSE；输入 PPALLP 输出 TRUE。", options: [], language: 'ArkTS', starterCode: "process.stdin.resume();\nprocess.stdin.setEncoding('utf-8');\nlet input = '';\nprocess.stdin.on('data', (data) => { input += data; });\nprocess.stdin.on('end', () => { /* 在此实现 */ });" };
